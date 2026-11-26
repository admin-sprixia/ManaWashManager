import type { Prisma } from '@prisma/client';
import type { DbClient } from '../client';
import { chunk } from '../chunk';
import {
  formatStock,
  REWARD_DISCOUNT_REASON,
  roundStock,
  stampCard,
  type StampVisit,
  type StockUnit,
} from '@mana/domain';
import { isUniqueClash, retryOnClash } from '../retryOnClash';
import { stockRepo } from './stockRepo';

/** One car's stamp card for one service, as the app shows it. */
export interface RewardCardView {
  /** The card's service: the free wash it gives (Basic Wash, also filled by Express and Premium). */
  serviceId: string;
  serviceName: string;
  every: number;
  stamps: number;
  free: number;
  lastVisitAt: string | null;
  /** When the card resets unless the car gets this service again; null = nothing to lose. */
  expiresAt: string | null;
  /** Paid visits since the card started or last reset; 1 = this card's first wash. */
  paidVisits: number;
  /** Welcome stamps on the card in its current run. */
  bonus: number;
}

/** A stamp-card rule as stored: a card of its own, or a service that fills another's card. */
interface RuleRow {
  serviceId: string;
  every: number;
  cardServiceId: string | null;
  stamps: number;
  bonusStamps: number;
  startsAt: Date | null;
}

/** The active cards, and which card (and how many stamps) each service's wash fills. */
function cardsOf(rules: RuleRow[]) {
  const cards = new Map(rules.filter((r) => !r.cardServiceId).map((r) => [r.serviceId, r]));
  const earns = new Map<string, { card: string; stamps: number }>();
  for (const r of rules) {
    const card = r.cardServiceId ?? r.serviceId;
    if (cards.has(card)) earns.set(r.serviceId, { card, stamps: r.stamps });
  }
  return { cards, earns };
}

/** A welcome-gift item, as owed to (or given to) a car. */
export interface RewardGiftView {
  id: string;
  jobId: string;
  vehicleId: string;
  customerId: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  quantity: number;
  status: 'owed' | 'given' | 'cancelled';
  createdAt: string;
  givenAt: string | null;
  givenBy: { id: string; name: string } | null;
}

export type GiveGiftResult =
  | { ok: true; gift: RewardGiftView }
  | { ok: false; error: 'gift_not_found' | 'gift_not_owed' | 'out_of_stock'; gift?: RewardGiftView };

const LIVE_JOB = { status: { not: 'void' } } as const;
const ACTIVE_RULE = { rewardRule: { is: { active: true } } } as const;
/** A job line that stamps a card: the service itself, or a combo that includes it. */
const STAMPING_LINE: Prisma.JobServiceWhereInput = {
  OR: [{ service: ACTIVE_RULE }, { service: { comboItems: { some: { service: ACTIVE_RULE } } } }],
};
/**
 * Vehicle ids per query when loading cards: each id is a bound parameter and D1 allows 100 per
 * query, with room left for the rest of the filter.
 */
const CARD_VEHICLES_PER_QUERY = 40;
/** A started wash is created within seconds of its free-wash claim; a stuck claim is let go after this. */
const CLAIM_IN_FLIGHT_MS = 2 * 60 * 1000;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function giftView(
  g: {
    id: string;
    jobId: string;
    vehicleId: string;
    customerId: string;
    stockItemId: string;
    quantity: number;
    status: string;
    createdAt: Date;
    givenAt: Date | null;
    givenByUserId: string | null;
  },
  items: Map<string, { name: string; unit: string }>,
  people: Map<string, string>,
): RewardGiftView {
  const item = items.get(g.stockItemId);
  return {
    id: g.id,
    jobId: g.jobId,
    vehicleId: g.vehicleId,
    customerId: g.customerId,
    stockItemId: g.stockItemId,
    itemName: item?.name ?? 'Item',
    unit: (item?.unit ?? 'pcs') as StockUnit,
    quantity: roundStock(g.quantity),
    status: g.status as RewardGiftView['status'],
    createdAt: g.createdAt.toISOString(),
    givenAt: iso(g.givenAt),
    givenBy: g.givenByUserId ? { id: g.givenByUserId, name: people.get(g.givenByUserId) ?? '' } : null,
  };
}

/** Gift rows with their item names and who handed them over, in one parallel round. */
async function loadGifts(db: DbClient, where: Prisma.RewardGiftWhereInput): Promise<RewardGiftView[]> {
  const [gifts, items, people] = await Promise.all([
    db.rewardGift.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.stockItem.findMany({ where: { rewardGifts: { some: where } }, select: { id: true, name: true, unit: true } }),
    db.user.findMany({ where: { rewardGiftsGiven: { some: where } }, select: { id: true, name: true } }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const personById = new Map(people.map((p) => [p.id, p.name]));
  return gifts.map((g) => giftView(g, itemById, personById));
}

/** The live washes, stamping lines and free-wash claims of the vehicles matching `vehicleWhere`. */
async function loadVisitRows(db: DbClient, vehicleWhere: Prisma.VehicleWhereInput) {
  const [jobs, lines, claims] = await Promise.all([
    db.job.findMany({
      where: { vehicle: vehicleWhere, ...LIVE_JOB, jobServices: { some: STAMPING_LINE } },
      select: { id: true, vehicleId: true, status: true, total: true, createdAt: true },
    }),
    db.jobService.findMany({
      where: { job: { vehicle: vehicleWhere, ...LIVE_JOB }, ...STAMPING_LINE },
      select: { jobId: true, serviceId: true, job: { select: { planServiceId: true } } },
    }),
    db.rewardClaim.findMany({ where: { vehicle: vehicleWhere }, select: { jobId: true, serviceId: true } }),
  ]);
  return { jobs, lines, claims };
}

/**
 * Every paid (or free-wash) visit that fills a stamp card, grouped by vehicle then card. A
 * service fills its own card or the one it's set to (Express and Premium fill Basic Wash's); a
 * combo fills each card its services do. One wash stamps a card once, with the most stamps any of
 * its lines gives. The line a plan paid for stamps nothing (it was prepaid), nor does a wash that
 * cost nothing, nor one from before its card started.
 */
function visitsByVehicle(
  { jobs, lines, claims }: Awaited<ReturnType<typeof loadVisitRows>>,
  combos: Map<string, string[]>,
  { cards, earns }: ReturnType<typeof cardsOf>,
): Map<string, Map<string, StampVisit[]>> {
  const covered = new Map<string, Map<string, number>>();
  const add = (set: Map<string, number>, serviceId: string) => {
    const e = earns.get(serviceId);
    if (e) set.set(e.card, Math.max(set.get(e.card) ?? 0, e.stamps));
  };
  for (const line of lines) {
    const set = covered.get(line.jobId) ?? new Map<string, number>();
    covered.set(line.jobId, set);
    if (line.serviceId === line.job.planServiceId) continue;
    add(set, line.serviceId);
    for (const s of combos.get(line.serviceId) ?? []) add(set, s);
  }
  const claimed = new Set(claims.map((c) => `${c.jobId}|${c.serviceId}`));
  const out = new Map<string, Map<string, StampVisit[]>>();
  for (const job of jobs) {
    for (const [card, stamps] of covered.get(job.id) ?? []) {
      const startsAt = cards.get(card)?.startsAt;
      if (startsAt && job.createdAt.getTime() < startsAt.getTime()) continue;
      const free = claimed.has(`${job.id}|${card}`);
      // An unpaid wash earns nothing yet; a free wash counts as used from the moment it starts.
      if (!free && (job.status !== 'paid' || job.total <= 0)) continue;
      const byService = out.get(job.vehicleId) ?? new Map<string, StampVisit[]>();
      const list = byService.get(card) ?? [];
      list.push({ at: job.createdAt, free, stamps });
      byService.set(card, list);
      out.set(job.vehicleId, byService);
    }
  }
  return out;
}

export const rewardRepo = {
  // ---------- Stamp-card rules ----------

  async listRules(db: DbClient) {
    const [rules, services] = await Promise.all([
      db.rewardRule.findMany({ orderBy: { createdAt: 'asc' } }),
      db.service.findMany({ where: { rewardRule: { isNot: null } }, select: { id: true, name: true, active: true } }),
    ]);
    const serviceById = new Map(services.map((s) => [s.id, s]));
    return rules.map((r) => ({
      serviceId: r.serviceId,
      serviceName: serviceById.get(r.serviceId)?.name ?? 'Service',
      serviceActive: serviceById.get(r.serviceId)?.active ?? false,
      every: r.every,
      active: r.active,
      /** Set: this service fills that service's card, `stamps` a wash. Null: a card of its own. */
      cardServiceId: r.cardServiceId,
      stamps: r.stamps,
      bonusStamps: r.bonusStamps,
      startsAt: iso(r.startsAt),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  async findRule(db: DbClient, serviceId: string) {
    return db.rewardRule.findUnique({ where: { serviceId } });
  },

  async saveRule(db: DbClient, data: { serviceId: string; every: number; userId: string }) {
    const now = new Date();
    await retryOnClash(() =>
      db.rewardRule.upsert({
        where: { serviceId: data.serviceId },
        create: { serviceId: data.serviceId, every: data.every, updatedByUserId: data.userId, createdAt: now, updatedAt: now },
        // A card of its own again, as this (older) screen means it.
        update: { every: data.every, active: true, cardServiceId: null, stamps: 1, updatedByUserId: data.userId, updatedAt: now },
      }),
    );
  },

  /**
   * Turns on (or changes) a card that several services fill: `serviceId`'s own card, with
   * `earners` (the card's service among them) putting their stamps on it. A card switched on now
   * counts washes from now; one already running keeps its start. Services that filled this card
   * and aren't in `earners` stop. Returns every service whose cars' cards may have changed.
   */
  async saveCard(
    db: DbClient,
    data: { serviceId: string; every: number; bonusStamps: number; earners: { serviceId: string; stamps: number }[]; userId: string; now: Date },
  ): Promise<string[]> {
    const before = await db.rewardRule.findMany({ where: { OR: [{ serviceId: { in: [data.serviceId, ...data.earners.map((e) => e.serviceId)] } }, { cardServiceId: data.serviceId }] } });
    const own = before.find((r) => r.serviceId === data.serviceId);
    const running = own?.active && !own.cardServiceId;
    const startsAt = running ? own.startsAt : data.now;
    const ownStamps = data.earners.find((e) => e.serviceId === data.serviceId)?.stamps ?? 1;
    const card = { every: data.every, active: true, cardServiceId: null, stamps: ownStamps, bonusStamps: data.bonusStamps, startsAt, updatedByUserId: data.userId, updatedAt: data.now };
    await retryOnClash(() =>
      db.rewardRule.upsert({ where: { serviceId: data.serviceId }, create: { serviceId: data.serviceId, ...card, createdAt: data.now }, update: card }),
    );
    for (const e of data.earners) {
      if (e.serviceId === data.serviceId) continue;
      const row = { every: data.every, active: true, cardServiceId: data.serviceId, stamps: e.stamps, bonusStamps: 0, startsAt: null, updatedByUserId: data.userId, updatedAt: data.now };
      await retryOnClash(() =>
        db.rewardRule.upsert({ where: { serviceId: e.serviceId }, create: { serviceId: e.serviceId, ...row, createdAt: data.now }, update: row }),
      );
    }
    const keep = new Set(data.earners.map((e) => e.serviceId));
    const dropped = before.filter((r) => r.cardServiceId === data.serviceId && r.active && !keep.has(r.serviceId)).map((r) => r.serviceId);
    if (dropped.length) {
      await db.rewardRule.updateMany({
        where: { serviceId: { in: dropped } },
        data: { active: false, updatedByUserId: data.userId, updatedAt: data.now },
      });
    }
    return [...new Set([data.serviceId, ...keep, ...dropped])];
  },

  /**
   * Switches a card off — and with it the services that filled it. Returns the services switched
   * off (empty when it wasn't on).
   */
  async disableRule(db: DbClient, serviceId: string, userId: string): Promise<string[]> {
    const live = await db.rewardRule.findMany({
      where: { active: true, OR: [{ serviceId }, { cardServiceId: serviceId }] },
      select: { serviceId: true },
    });
    if (!live.some((r) => r.serviceId === serviceId)) return [];
    const ids = live.map((r) => r.serviceId);
    await db.rewardRule.updateMany({
      where: { serviceId: { in: ids } },
      data: { active: false, updatedByUserId: userId, updatedAt: new Date() },
    });
    return ids;
  },

  /**
   * Re-sends to phones every car whose card for `serviceId` may have changed (it had that
   * service, alone or in a combo), so their offline copy shows the new rule.
   */
  async touchVehiclesWithService(db: DbClient, serviceId: string) {
    await db.vehicle.updateMany({
      where: {
        jobs: {
          some: {
            ...LIVE_JOB,
            jobServices: { some: { OR: [{ serviceId }, { service: { comboItems: { some: { serviceId } } } }] } },
          },
        },
      },
      data: { updatedAt: new Date() },
    });
  },

  // ---------- Stamp cards ----------

  /**
   * Live stamp cards (with stamps or a free wash on them) for the given vehicles, keyed by
   * vehicle id. Cards are worked out from history every time — see @mana/domain `stampCard`.
   */
  async cardsForVehicles(db: DbClient, vehicleIds: string[], now: Date): Promise<Map<string, RewardCardView[]>> {
    const ids = [...new Set(vehicleIds)];
    if (ids.length === 0) return new Map();
    return this.cardsWhere(db, ids.length <= CARD_VEHICLES_PER_QUERY ? { id: { in: ids } } : ids, now);
  },

  /** Same as `cardsForVehicles`, for every vehicle matching a filter (or a long id list). */
  async cardsWhere(
    db: DbClient,
    vehicles: Prisma.VehicleWhereInput | string[],
    now: Date,
  ): Promise<Map<string, RewardCardView[]>> {
    const wheres: Prisma.VehicleWhereInput[] = Array.isArray(vehicles)
      ? chunk(vehicles, CARD_VEHICLES_PER_QUERY).map((slice) => ({ id: { in: slice } }))
      : [vehicles];
    const [rules, services, comboItems, rows] = await Promise.all([
      db.rewardRule.findMany({ where: { active: true } }),
      db.service.findMany({ where: ACTIVE_RULE, select: { id: true, name: true, sortOrder: true } }),
      db.serviceComboItem.findMany({ where: { service: ACTIVE_RULE }, select: { comboId: true, serviceId: true } }),
      Promise.all(wheres.map((where) => loadVisitRows(db, where))),
    ]);
    if (rules.length === 0) return new Map();
    const shape = cardsOf(rules);
    const combos = new Map<string, string[]>();
    for (const item of comboItems) {
      if (!shape.earns.has(item.serviceId)) continue;
      combos.set(item.comboId, [...(combos.get(item.comboId) ?? []), item.serviceId]);
    }
    const visits = rows.map((r) => visitsByVehicle(r, combos, shape));
    const serviceById = new Map(services.map((s) => [s.id, s]));
    const ordered = [...shape.cards.values()].sort((a, b) => {
      const sa = serviceById.get(a.serviceId);
      const sb = serviceById.get(b.serviceId);
      return (sa?.sortOrder ?? 0) - (sb?.sortOrder ?? 0) || (sa?.name ?? '').localeCompare(sb?.name ?? '');
    });
    const out = new Map<string, RewardCardView[]>();
    for (const map of visits) {
      for (const [vehicleId, byService] of map) {
        const cards: RewardCardView[] = [];
        for (const rule of ordered) {
          const card = stampCard(rule.every, byService.get(rule.serviceId) ?? [], now, { bonus: rule.bonusStamps });
          if (card.stamps === 0 && card.free === 0) continue;
          cards.push({
            serviceId: rule.serviceId,
            serviceName: serviceById.get(rule.serviceId)?.name ?? 'Service',
            every: rule.every,
            stamps: card.stamps,
            free: card.free,
            lastVisitAt: iso(card.lastVisitAt),
            expiresAt: iso(card.expiresAt),
            paidVisits: card.paidVisits,
            bonus: card.bonus,
          });
        }
        if (cards.length > 0) out.set(vehicleId, cards);
      }
    }
    return out;
  },

  /**
   * Spends one free wash from a car's card for `jobId`. The next sequence number is taken and a
   * unique index stops two requests taking the same one: the loser gets false (unless the claim
   * is already this job's — a replay).
   */
  /**
   * Read *before* the car's cards when a free wash is about to be used. Per service: the claim
   * number this wash must take (so any claim written after this read clashes with it), and how
   * many free washes other phones have claimed but not yet turned into a wash — the cards can't
   * see those yet. A claim whose wash never appeared stops counting after a short while.
   */
  async claimsInProgress(
    db: DbClient,
    data: { vehicleId: string; jobId: string; now: Date },
  ): Promise<Map<string, { nextSeq: number; inFlight: number }>> {
    const claims = await db.rewardClaim.findMany({
      where: { vehicleId: data.vehicleId },
      select: { jobId: true, serviceId: true, seq: true, createdAt: true },
    });
    const recent = claims.filter(
      (c) => c.jobId !== data.jobId && data.now.getTime() - c.createdAt.getTime() < CLAIM_IN_FLIGHT_MS,
    );
    const started = recent.length
      ? new Set(
          (
            await db.job.findMany({
              where: { id: { in: [...new Set(recent.map((c) => c.jobId))] } },
              select: { id: true },
            })
          ).map((j) => j.id),
        )
      : new Set<string>();
    const out = new Map<string, { nextSeq: number; inFlight: number }>();
    for (const c of claims) {
      const entry = out.get(c.serviceId) ?? { nextSeq: 1, inFlight: 0 };
      entry.nextSeq = Math.max(entry.nextSeq, c.seq + 1);
      out.set(c.serviceId, entry);
    }
    for (const c of recent) {
      if (!started.has(c.jobId)) out.get(c.serviceId)!.inFlight++;
    }
    return out;
  },

  /** False when another wash took this claim number first (a replay of this same wash is true). */
  async claimFree(
    db: DbClient,
    data: { vehicleId: string; serviceId: string; seq: number; jobId: string; userId: string; now: Date },
  ) {
    try {
      await db.rewardClaim.create({
        data: {
          vehicleId: data.vehicleId,
          serviceId: data.serviceId,
          seq: data.seq,
          jobId: data.jobId,
          createdByUserId: data.userId,
          createdAt: data.now,
        },
      });
      return true;
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
      const mine = await db.rewardClaim.findUnique({
        where: { jobId_serviceId: { jobId: data.jobId, serviceId: data.serviceId } },
      });
      return mine != null;
    }
  },

  /** Hands the free washes back when the job they were claimed for couldn't be created. */
  async releaseClaims(db: DbClient, jobId: string) {
    await db.rewardClaim.deleteMany({ where: { jobId } });
  },

  async claimedServiceIds(db: DbClient, jobId: string): Promise<string[]> {
    const rows = await db.rewardClaim.findMany({ where: { jobId }, select: { serviceId: true } });
    return rows.map((r) => r.serviceId);
  },

  // ---------- Welcome gift ----------

  async listGiftItems(db: DbClient) {
    const [rows, items] = await Promise.all([
      db.rewardGiftItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { stockItemId: 'asc' }] }),
      db.stockItem.findMany({ where: { giftItem: { isNot: null } } }),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return rows.flatMap((r) => {
      const item = itemById.get(r.stockItemId);
      if (!item) return [];
      return [
        {
          stockItemId: r.stockItemId,
          name: item.name,
          unit: item.unit as StockUnit,
          quantity: roundStock(r.quantity),
          balance: roundStock(item.balance),
          active: item.active,
        },
      ];
    });
  },

  /** Replaces the welcome gift with `items` (in this order). */
  async setGiftItems(db: DbClient, items: { stockItemId: string; quantity: number }[], userId: string) {
    const now = new Date();
    const keep = items.map((i) => i.stockItemId);
    await db.rewardGiftItem.deleteMany({ where: keep.length ? { stockItemId: { notIn: keep } } : {} });
    await Promise.all(
      items.map((item, sortOrder) =>
        retryOnClash(() =>
          db.rewardGiftItem.upsert({
            where: { stockItemId: item.stockItemId },
            create: { stockItemId: item.stockItemId, quantity: roundStock(item.quantity), sortOrder, updatedByUserId: userId, updatedAt: now },
            update: { quantity: roundStock(item.quantity), sortOrder, updatedByUserId: userId, updatedAt: now },
          }),
        ),
      ),
    );
  },

  async removeGiftItem(db: DbClient, stockItemId: string) {
    await db.rewardGiftItem.deleteMany({ where: { stockItemId } });
  },

  /** True when no other live wash of this car came before `job` — its first visit. */
  async isFirstVisit(db: DbClient, job: { id: string; vehicleId: string; createdAt: Date }) {
    const earlier = await db.job.count({
      where: {
        vehicleId: job.vehicleId,
        ...LIVE_JOB,
        id: { not: job.id },
        OR: [{ createdAt: { lt: job.createdAt } }, { createdAt: job.createdAt, id: { lt: job.id } }],
      },
    });
    return earlier === 0;
  },

  /**
   * Writes the welcome gift for a car's first paid wash and hands over what's in stock; the rest
   * stays owed. Safe to repeat: gift ids come from the job, and a car never holds two live gifts
   * of one item (unique index), so a retry or a race only finishes what's missing.
   */
  async issueForPaidJob(
    db: DbClient,
    data: {
      job: { id: string; vehicleId: string; customerId: string };
      registrationNumber: string;
      items: { stockItemId: string; quantity: number }[];
      userId: string;
      now: Date;
    },
  ) {
    await Promise.all(
      data.items.map((item) =>
        db.rewardGift
          .create({
            data: {
              id: `${data.job.id}:${item.stockItemId}`,
              jobId: data.job.id,
              vehicleId: data.job.vehicleId,
              customerId: data.job.customerId,
              stockItemId: item.stockItemId,
              quantity: roundStock(item.quantity),
              createdAt: data.now,
            },
          })
          .catch((e: unknown) => {
            // Already written by a retry, or the car already holds this gift.
            if (!isUniqueClash(e)) throw e;
          }),
      ),
    );
    const owed = await db.rewardGift.findMany({ where: { jobId: data.job.id, status: 'owed' } });
    for (const gift of owed) {
      await this.handOver(db, gift, { userId: data.userId, now: data.now, note: `Welcome gift · ${data.registrationNumber}` });
    }
  },

  /**
   * Takes an owed gift out of stock and marks it given. False (still owed) when the shelf
   * doesn't hold enough. The stock move id is fixed per gift, so a retry never takes it twice.
   */
  async handOver(
    db: DbClient,
    gift: { id: string; stockItemId: string; quantity: number },
    data: { userId: string; now: Date; note: string },
  ): Promise<boolean> {
    const moveId = `gift:${gift.id}`;
    if (!(await stockRepo.findMove(db, moveId))) {
      let moved: Awaited<ReturnType<typeof stockRepo.applyMove>>;
      try {
        moved = await stockRepo.applyMove(db, {
          id: moveId,
          itemId: gift.stockItemId,
          kind: 'gift',
          delta: -gift.quantity,
          note: data.note,
          createdByUserId: data.userId,
          ifAtLeast: gift.quantity,
        });
      } catch (e) {
        if (!(await stockRepo.findMove(db, moveId))) throw e;
        moved = null;
      }
      if (!moved && !(await stockRepo.findMove(db, moveId))) return false;
    }
    await db.rewardGift.updateMany({
      where: { id: gift.id, status: 'owed' },
      data: { status: 'given', givenAt: data.now, givenByUserId: data.userId },
    });
    return true;
  },

  /** Staff hand over an owed gift — at a later visit, or whenever the customer drops by. */
  async give(db: DbClient, giftId: string, data: { userId: string; now: Date }): Promise<GiveGiftResult> {
    const gift = await db.rewardGift.findUnique({ where: { id: giftId } });
    if (!gift) return { ok: false, error: 'gift_not_found' };
    const view = async () => (await loadGifts(db, { id: giftId }))[0]!;
    if (gift.status === 'given') return { ok: true, gift: await view() };
    if (gift.status !== 'owed') return { ok: false, error: 'gift_not_owed', gift: await view() };
    const vehicle = await db.vehicle.findUnique({ where: { id: gift.vehicleId }, select: { registrationNumber: true } });
    const given = await this.handOver(db, gift, {
      userId: data.userId,
      now: data.now,
      note: `Welcome gift · ${vehicle?.registrationNumber ?? 'customer'} (owed)`,
    });
    if (!given) return { ok: false, error: 'out_of_stock', gift: await view() };
    await db.vehicle.updateMany({ where: { id: gift.vehicleId }, data: { updatedAt: new Date() } });
    const after = await view();
    // Voided while we were handing it over: report what really happened.
    if (after.status !== 'given') return { ok: false, error: 'gift_not_owed', gift: after };
    return { ok: true, gift: after };
  },

  /**
   * A voided wash takes its welcome gift back: given stock goes back on the shelf (move fixed
   * per gift, written before the gift is cancelled so a crash in between is finished by a
   * retry), and owed gifts are simply cancelled. Safe to run more than once.
   */
  async returnForVoidedJob(db: DbClient, jobId: string, data: { userId: string; now: Date }) {
    for (let round = 0; round < 3; round++) {
      const live = await db.rewardGift.findMany({ where: { jobId, status: { not: 'cancelled' } } });
      if (live.length === 0) return;
      let raced = false;
      for (const gift of live) {
        if (gift.status === 'given') {
          const backId = `gift-back:${gift.id}`;
          if (!(await stockRepo.findMove(db, backId))) {
            try {
              await stockRepo.applyMove(db, {
                id: backId,
                itemId: gift.stockItemId,
                kind: 'void',
                delta: gift.quantity,
                note: 'Welcome gift back · wash voided',
                createdByUserId: data.userId,
              });
            } catch (e) {
              if (!(await stockRepo.findMove(db, backId))) throw e;
            }
          }
        }
        const done = await db.rewardGift.updateMany({
          where: { id: gift.id, status: gift.status },
          data: { status: 'cancelled', cancelledAt: data.now },
        });
        if (done.count !== 1) raced = true;
      }
      if (!raced) return;
    }
  },

  /** Gifts of one job (any status), for the job's detail screen. */
  async giftsForJob(db: DbClient, jobId: string) {
    return loadGifts(db, { jobId });
  },

  /** Owed and given gifts of these vehicles, oldest first (cancelled ones left out). */
  async giftsForVehicles(db: DbClient, vehicleIds: string[]) {
    const lists = await Promise.all(
      chunk(vehicleIds, 60).map((slice) => loadGifts(db, { vehicleId: { in: slice }, status: { not: 'cancelled' } })),
    );
    return lists.flat();
  },

  /** Owed gifts, oldest first — for one car, one customer, or the whole shop. */
  async owedGifts(db: DbClient, filter: { vehicleIds?: string[]; customerId?: string } = {}) {
    const where: Prisma.RewardGiftWhereInput = {
      status: 'owed',
      ...(filter.vehicleIds ? { vehicleId: { in: filter.vehicleIds } } : {}),
      ...(filter.customerId ? { vehicle: { customerId: filter.customerId } } : {}),
    };
    return loadGifts(db, where);
  },

  /** Owed gifts for the whole shop with the car and customer they're for. */
  async owedGiftsWithCustomers(db: DbClient) {
    const where: Prisma.RewardGiftWhereInput = { status: 'owed' };
    const [gifts, vehicles, customers] = await Promise.all([
      loadGifts(db, where),
      db.vehicle.findMany({ where: { rewardGifts: { some: where } }, select: { id: true, registrationNumber: true, customerId: true } }),
      db.customer.findMany({ where: { vehicles: { some: { rewardGifts: { some: where } } } }, select: { id: true, name: true, phone: true } }),
    ]);
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const customerById = new Map(customers.map((c) => [c.id, c]));
    return gifts.map((g) => {
      const vehicle = vehicleById.get(g.vehicleId);
      const customer = vehicle ? customerById.get(vehicle.customerId) : undefined;
      return {
        ...g,
        registrationNumber: vehicle?.registrationNumber ?? '',
        customerId: vehicle?.customerId ?? g.customerId,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? '',
      };
    });
  },

  /** Owed gifts per vehicle, for the offline directory. */
  async owedCountByVehicle(db: DbClient, vehicleIds: string[]): Promise<Map<string, number>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await Promise.all(
      chunk(vehicleIds).map((slice) =>
        db.rewardGift.groupBy({ by: ['vehicleId'], where: { status: 'owed', vehicleId: { in: slice } }, _count: { _all: true } }),
      ),
    );
    return new Map(rows.flat().map((r) => [r.vehicleId, r._count._all]));
  },

  /** Owed gifts per stock item: how many customers are waiting for it, and how much in all. */
  async owedByItem(db: DbClient): Promise<Map<string, { count: number; quantity: number }>> {
    const rows = await db.rewardGift.groupBy({
      by: ['stockItemId'],
      where: { status: 'owed' },
      _count: { _all: true },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.stockItemId, { count: r._count._all, quantity: roundStock(r._sum.quantity ?? 0) }]));
  },

  async countOwed(db: DbClient) {
    return db.rewardGift.count({ where: { status: 'owed' } });
  },

  // ---------- Reports ----------

  /**
   * Free washes used on paid washes started in `[from, to)` (and what they were worth at the
   * car's size), welcome gifts handed over in the window per item, and gifts owed right now.
   */
  async report(db: DbClient, from: Date, to: Date) {
    const paidInWindow = { status: 'paid', createdAt: { gte: from, lt: to } };
    const [claims, freeLines, given, items, owedNow] = await Promise.all([
      db.rewardClaim.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { jobId: true, serviceId: true } }),
      db.jobService.findMany({
        where: { job: { ...paidInWindow, discountReason: { startsWith: REWARD_DISCOUNT_REASON } } },
        select: { jobId: true, serviceId: true, priceAtTime: true },
      }),
      db.rewardGift.groupBy({
        by: ['stockItemId'],
        where: { status: 'given', givenAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      db.stockItem.findMany({
        where: { rewardGifts: { some: { status: 'given', givenAt: { gte: from, lt: to } } } },
        select: { id: true, name: true, unit: true },
      }),
      db.rewardGift.count({ where: { status: 'owed' } }),
    ]);
    const claimed = new Set(claims.map((c) => `${c.jobId}|${c.serviceId}`));
    let freeWashes = 0;
    let freeValue = 0;
    for (const line of freeLines) {
      if (!claimed.has(`${line.jobId}|${line.serviceId}`)) continue;
      freeWashes += 1;
      freeValue += line.priceAtTime;
    }
    const itemById = new Map(items.map((i) => [i.id, i]));
    const gifts = given
      .map((g) => {
        const item = itemById.get(g.stockItemId);
        const unit = (item?.unit ?? 'pcs') as StockUnit;
        const quantity = roundStock(g._sum.quantity ?? 0);
        return {
          stockItemId: g.stockItemId,
          name: item?.name ?? 'Item',
          unit,
          count: g._count._all,
          quantity,
          label: formatStock(quantity, unit),
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      freeWashes,
      freeValue,
      giftsGiven: gifts.reduce((n, g) => n + g.count, 0),
      gifts,
      giftsOwedNow: owedNow,
    };
  },
};
