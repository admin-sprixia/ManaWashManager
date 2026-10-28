import type { Prisma } from '@prisma/client';
import {
  addDaysTo,
  clusterPoints,
  compareUnits,
  distanceMeters,
  formatInspection,
  formatSlots,
  formatTeam,
  formatWashDays,
  INTEREST_RADIUS_M,
  isDueOn,
  istDay,
  MAX_PLACE_PHOTOS,
  missingForReview,
  parseInspection,
  parseSlots,
  parseTeam,
  weekdayOf,
  type Inspection,
  type PlacePhotoKind,
  type PlaceStage,
  type ProposedSlot,
  NEARBY_PLACES_KM,
  NEARBY_PLACES_MAX,
  nextWashDays,
  normalizeUnit,
  OPEN_REQUEST_STATUSES,
  parseMemberChecks,
  parseWashDays,
  PLACE_CODE_LENGTH,
  placeCodeFrom,
  unitLabel,
  type GeoPoint,
  type JoinedVia,
  type MemberCheck,
  type MemberStatus,
  type PlaceStatus,
  type PlaceType,
  type VisitOutcome,
} from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { isUniqueClash } from '../retryOnClash';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import type { CustomerLink } from './customerAppRepo';
import {
  businessRules,
  orderStateSelect,
  orderSummary,
  phaseOf,
  placeFail,
  planWashOf,
  scheduleOf,
  shopContext,
  type OrderStateRow,
} from './placeShared';

/**
 * Places a branch's team washes at on fixed days, their flats and houses, and their members.
 * Every read and write is pinned to the branch (shop-scoped client or `shop_id = ?`), except the
 * few public lookups the Mana Wash app makes before anyone joins (nearby places, a QR code).
 */

// Workers and Node both have Web Crypto; declared here because the packages build with lib ES2022.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const newPlaceCode = () => placeCodeFrom(crypto.getRandomValues(new Uint8Array(PLACE_CODE_LENGTH)));

const LIVE_MEMBER = { in: ['pending', 'active'] };
const LIVE_ORDER = { in: ['waitlist', 'awaiting_payment', 'active'] };

export interface PlaceInput {
  type: PlaceType;
  name: string | null;
  label: string;
  latitude: number;
  longitude: number;
  washDays: number[];
  washTime: string;
  needsApproval: boolean;
  capacity: number | null;
}

/** What the teammate who inspects a community fills in. */
export interface PlaceSetupInput {
  type: PlaceType;
  name: string | null;
  label: string;
  latitude: number;
  longitude: number;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** The security guard at the gate, if there is one. */
  securityName: string | null;
  securityPhone: string | null;
  inspection: Inspection;
  slots: ProposedSlot[];
}

/** What the owner decides when making a community live. */
export interface PlaceApproval {
  washDays: number[];
  washTime: string;
  teamUserIds: string[];
  needsApproval: boolean;
  capacity: number | null;
}

const placeSelect = {
  id: true,
  shopId: true,
  code: true,
  type: true,
  name: true,
  label: true,
  latitude: true,
  longitude: true,
  photoKey: true,
  washDays: true,
  washTime: true,
  needsApproval: true,
  capacity: true,
  status: true,
  stage: true,
  createdAt: true,
} as const;

const setupSelect = {
  name: true,
  inspection: true,
  contactName: true,
  contactPhone: true,
  securityName: true,
  securityPhone: true,
  notes: true,
  proposedSlots: true,
  teamUserIds: true,
  reviewNote: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  createdByUserId: true,
} as const;

type PlaceRow = {
  id: string;
  shopId: string;
  code: string;
  type: string;
  name: string | null;
  label: string;
  latitude: number;
  longitude: number;
  photoKey: string | null;
  washDays: string;
  washTime: string;
  needsApproval: boolean;
  capacity: number | null;
  status: string;
  stage: string;
  createdAt?: Date;
};

/** Only live, running communities are open to customers. */
const PUBLIC_PLACE = { status: 'active', stage: 'live' } as const;

/** Stands in for the wash time of a draft with no proposed slot yet. */
const DRAFT_TIME = '06:30';

/** What anyone may see of a place: enough to recognise it and know when the team comes. */
export function placeView(p: PlaceRow, now: Date) {
  const washDays = parseWashDays(p.washDays);
  return {
    id: p.id,
    code: p.code,
    type: p.type as PlaceType,
    name: p.name,
    label: p.label,
    location: { latitude: p.latitude, longitude: p.longitude },
    hasPhoto: p.photoKey != null,
    washDays,
    washTime: p.washTime,
    needsApproval: p.needsApproval,
    capacity: p.capacity,
    status: p.status as PlaceStatus,
    stage: p.stage as PlaceStage,
    nextWashDays: p.stage === 'live' ? nextWashDays(washDays, istDay(now), 3) : [],
    /** When the team first saved it (the visit). */
    createdAt: p.createdAt?.toISOString() ?? null,
  };
}

export type PlaceView = ReturnType<typeof placeView>;

type SetupRow = {
  name: string | null;
  inspection: string | null;
  contactName: string | null;
  contactPhone: string | null;
  securityName: string | null;
  securityPhone: string | null;
  notes: string | null;
  proposedSlots: string | null;
  teamUserIds: string | null;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  createdByUserId: string | null;
};

type Person = { id: string; name: string };

/** The team's view of how a community was set up: the inspection, contact, team and review. */
function setupView(p: SetupRow, people: Map<string, string>, photos: readonly PlacePhotoKind[]) {
  const person = (id: string | null): Person | null => (id && people.has(id) ? { id, name: people.get(id)! } : null);
  const inspection = parseInspection(p.inspection);
  const slots = parseSlots(p.proposedSlots);
  return {
    inspection,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    securityName: p.securityName,
    securityPhone: p.securityPhone,
    notes: p.notes,
    slots,
    team: parseTeam(p.teamUserIds).flatMap((id) => (people.has(id) ? [{ id, name: people.get(id)! }] : [])),
    reviewNote: p.reviewNote,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    reviewedBy: person(p.reviewedByUserId),
    createdBy: person(p.createdByUserId),
    missing: missingForReview({ name: p.name, photos, inspection, slots, contactName: p.contactName, contactPhone: p.contactPhone }),
  };
}

async function peopleOf(db: DbClient): Promise<Map<string, string>> {
  const users = await db.user.findMany({ select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const memberSelect = {
  id: true,
  placeId: true,
  customerId: true,
  unitText: true,
  status: true,
  joinedVia: true,
  distanceM: true,
  checks: true,
  parkingNote: true,
  createdAt: true,
  handledAt: true,
  endedAt: true,
  endReason: true,
  unit: { select: { id: true, block: true, number: true } },
  customer: { select: { id: true, name: true, phone: true } },
  vehicles: {
    where: { status: 'active' },
    select: {
      id: true,
      vehicleTypeId: true,
      vehicleType: { select: { name: true, category: true } },
      vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
      orders: { orderBy: { createdAt: 'desc' as const }, take: 3, select: orderStateSelect },
    },
  },
} as const;

type MemberRow = {
  id: string;
  placeId: string;
  customerId: string;
  unitText: string | null;
  status: string;
  joinedVia: string;
  distanceM: number | null;
  checks: string | null;
  parkingNote: string | null;
  createdAt: Date;
  handledAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  unit: { id: string; block: string | null; number: string } | null;
  customer: { id: string; name: string | null; phone: string };
  vehicles: {
    id: string;
    vehicleTypeId: string;
    vehicleType: { name: string; category: string };
    vehicle: { id: string; registrationNumber: string; make: string | null; model: string | null } | null;
    orders: OrderStateRow[];
  }[];
};

const unitOf = (m: { unit: { block: string | null; number: string } | null; unitText: string | null }) =>
  m.unit ? unitLabel(m.unit.block, m.unit.number) : (m.unitText ?? '');

function memberView(m: MemberRow, washDays: string, rules: Parameters<typeof orderSummary>[2], now: Date) {
  return {
    id: m.id,
    placeId: m.placeId,
    status: m.status as MemberStatus,
    joinedVia: m.joinedVia as JoinedVia,
    distanceM: m.distanceM,
    checks: parseMemberChecks(m.checks),
    unit: unitOf(m),
    unitId: m.unit?.id ?? null,
    parkingNote: m.parkingNote,
    customer: { id: m.customer.id, name: m.customer.name, phone: m.customer.phone },
    createdAt: m.createdAt.toISOString(),
    endedAt: m.endedAt?.toISOString() ?? null,
    endReason: m.endReason,
    vehicles: m.vehicles.map((v) => ({
      id: v.id,
      vehicleTypeId: v.vehicleTypeId,
      typeName: v.vehicleType.name,
      category: v.vehicleType.category === 'bike' ? ('bike' as const) : ('car' as const),
      vehicle: v.vehicle,
      /** The newest order first; the live one (if any) is what the team acts on. */
      orders: v.orders.map((o) => orderSummary(o, washDays, rules, now)),
    })),
  };
}

export type PlaceMemberView = ReturnType<typeof memberView>;

function loadDayOrders(db: DbClient, where: Prisma.PlaceOrderWhereInput) {
  return db.placeOrder.findMany({
    where,
    select: {
      ...orderStateSelect,
      snapshot: true,
      visits: {
        select: {
          id: true,
          date: true,
          outcome: true,
          byCustomer: true,
          note: true,
          byUserId: true,
          createdAt: true,
          photoKey: true,
          distanceM: true,
        },
      },
      member: {
        select: {
          id: true,
          placeId: true,
          unitText: true,
          parkingNote: true,
          unit: { select: { block: true, number: true } },
          customer: { select: { name: true, phone: true } },
        },
      },
      memberVehicle: {
        select: {
          id: true,
          vehicleType: { select: { name: true, category: true } },
          vehicle: { select: { registrationNumber: true, make: true, model: true } },
        },
      },
    },
  });
}

type DayOrder = Awaited<ReturnType<typeof loadDayOrders>>[number];

/**
 * Whether a vehicle is on a day's list: false when not, otherwise that day's record (null if not
 * recorded yet). Vehicles waiting for their first payment show on their first wash day only.
 */
function dueVisit(o: DayOrder, washDays: number[], day: string): DayOrder['visits'][number] | null | false {
  const visit = o.visits.find((v) => v.date === day) ?? null;
  if (visit) return visit;
  if (o.status === 'awaiting_payment' && o.firstWashOn === day) return null;
  if (o.status === 'active' && isDueOn(scheduleOf(o, washDays, day), day)) return null;
  return false;
}

export const placeRepo = {
  // ---------- The team ----------

  /**
   * A new community starts as a draft from the on-site inspection. Customers can't see or join
   * it until the owner approves it; until then the first proposed slot stands in for the days.
   */
  async create(d1: D1Database, shopId: string, input: PlaceSetupInput, byUserId: string): Promise<{ id: string; code: string }> {
    const id = newId();
    const first = input.slots[0];
    for (let attempt = 0; ; attempt++) {
      const code = newPlaceCode();
      try {
        await runStatements(d1, [
          {
            sql: `INSERT INTO places (id, shop_id, code, type, name, label, latitude, longitude, wash_days, wash_time,
                    needs_approval, created_by_user_id, stage, inspection, contact_name, contact_phone, security_name, security_phone,
                    notes, proposed_slots)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              id,
              shopId,
              code,
              input.type,
              input.name,
              input.label,
              input.latitude,
              input.longitude,
              formatWashDays(first?.days ?? [6]),
              first?.time ?? DRAFT_TIME,
              byUserId,
              formatInspection(input.inspection),
              input.contactName,
              input.contactPhone,
              input.securityName,
              input.securityPhone,
              input.notes,
              formatSlots(input.slots),
            ],
          },
        ]);
        return { id, code };
      } catch (e) {
        if (!isUniqueClash(e) || attempt >= 4) throw e;
      }
    }
  },

  /** Edits what the inspection found. Running details (days, team, prices) are set on approval. */
  async updateSetup(d1: D1Database, shopId: string, id: string, patch: Partial<PlaceSetupInput>) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id }, select: { ...placeSelect, ...setupSelect } });
    if (!place) return placeFail('not_found', 'Place not found.');
    const draft = place.stage !== 'live';
    const first = patch.slots?.[0];
    await runStatements(d1, [
      {
        sql: `UPDATE places SET type = ?, name = ?, label = ?, latitude = ?, longitude = ?, inspection = ?, contact_name = ?,
                contact_phone = ?, security_name = ?, security_phone = ?, notes = ?, proposed_slots = ?, wash_days = ?, wash_time = ?, updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ?`,
        params: [
          patch.type ?? place.type,
          patch.name !== undefined ? patch.name : place.name,
          patch.label ?? place.label,
          patch.latitude ?? place.latitude,
          patch.longitude ?? place.longitude,
          patch.inspection ? formatInspection(patch.inspection) : place.inspection,
          patch.contactName !== undefined ? patch.contactName : place.contactName,
          patch.contactPhone !== undefined ? patch.contactPhone : place.contactPhone,
          patch.securityName !== undefined ? patch.securityName : place.securityName,
          patch.securityPhone !== undefined ? patch.securityPhone : place.securityPhone,
          patch.notes !== undefined ? patch.notes : place.notes,
          patch.slots ? formatSlots(patch.slots) : place.proposedSlots,
          draft && first ? formatWashDays(first.days) : place.washDays,
          draft && first ? first.time : place.washTime,
          shopId,
          id,
        ],
      },
    ]);
  },

  /** The teammate sends the draft to the owner. Everything the owner needs must be filled in. */
  async submit(d1: D1Database, shopId: string, id: string) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id }, select: { stage: true, ...setupSelect } });
    if (!place) return placeFail('not_found', 'Place not found.');
    if (place.stage !== 'draft') return placeFail('conflict', 'This community is already sent.');
    const photos = await db.placePhoto.findMany({ where: { placeId: id }, select: { kind: true } });
    const missing = missingForReview({
      name: place.name,
      photos: photos.map((x) => x.kind as PlacePhotoKind),
      inspection: parseInspection(place.inspection),
      slots: parseSlots(place.proposedSlots),
      contactName: place.contactName,
      contactPhone: place.contactPhone,
    });
    if (missing.length) return placeFail('invalid', `Please add: ${missing.join(', ')}.`);
    await db.place.updateMany({ where: { id, stage: 'draft' }, data: { stage: 'review', submittedAt: new Date() } });
  },

  /** The owner sends a draft back to the teammate with what to fix. */
  async sendBack(d1: D1Database, shopId: string, id: string, note: string, byUserId: string) {
    const { count } = await createShopDb(d1, shopId).place.updateMany({
      where: { id, stage: 'review' },
      data: { stage: 'draft', reviewNote: note, reviewedByUserId: byUserId, reviewedAt: new Date() },
    });
    if (count !== 1) return placeFail('conflict', 'Only a community waiting for approval can be sent back.');
  },

  /** The owner sets the days, time and team, and the community goes live for customers. */
  async goLive(d1: D1Database, shopId: string, id: string, input: PlaceApproval, byUserId: string) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id }, select: { stage: true, status: true } });
    if (!place) return placeFail('not_found', 'Place not found.');
    if (place.stage === 'live') return placeFail('conflict', 'This community is already live.');
    if (place.status === 'closed') return placeFail('not_allowed', 'This community is closed.');
    // Members pick their flat (or house) when they join, so the list has to be there first.
    const units = await db.placeUnit.count({ where: { placeId: id, archivedAt: null } });
    if (!units) return placeFail('invalid', 'Add the flats (or houses) first, so members can pick theirs.');
    const team = await this.validTeam(db, input.teamUserIds);
    await runStatements(d1, [
      {
        sql: `UPDATE places SET stage = 'live', status = 'active', wash_days = ?, wash_time = ?, team_user_ids = ?,
                needs_approval = ?, capacity = ?, review_note = NULL, reviewed_by_user_id = ?, reviewed_at = ?,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND stage != 'live'`,
        params: [
          formatWashDays(input.washDays),
          input.washTime,
          formatTeam(team),
          input.needsApproval,
          input.capacity,
          byUserId,
          new Date().toISOString(),
          shopId,
          id,
        ],
      },
    ]);
  },

  /** Changes who washes at a live community. */
  async setTeam(d1: D1Database, shopId: string, id: string, userIds: string[]) {
    const db = createShopDb(d1, shopId);
    const team = await this.validTeam(db, userIds);
    const { count } = await db.place.updateMany({ where: { id }, data: { teamUserIds: formatTeam(team) } });
    if (count !== 1) return placeFail('not_found', 'Place not found.');
  },

  async validTeam(db: DbClient, userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const users = await db.user.findMany({ where: { id: { in: userIds }, active: true, removedAt: null }, select: { id: true } });
    const ok = new Set(users.map((u) => u.id));
    return userIds.filter((u) => ok.has(u));
  },

  /** A community with how it was set up, for the team. */
  async detail(d1: D1Database, shopId: string, id: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id }, select: { ...placeSelect, ...setupSelect } });
    if (!place) return null;
    const [people, photos] = await Promise.all([peopleOf(db), this.photos(db, id)]);
    return { ...placeView(place, now), setup: setupView(place, people, photos.map((x) => x.kind)), photos };
  },

  // ---------- Community photos ----------

  async photos(db: DbClient, placeId: string) {
    const rows = await db.placePhoto.findMany({
      where: { placeId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, kind: r.kind as PlacePhotoKind, createdAt: r.createdAt.toISOString() }));
  },

  /** Adds a photo; the first one also becomes the community's cover picture. */
  async addPhoto(d1: D1Database, shopId: string, placeId: string, kind: PlacePhotoKind, photoKey: string, byUserId: string) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id: placeId }, select: { photoKey: true } });
    if (!place) return placeFail('not_found', 'Place not found.');
    if ((await db.placePhoto.count({ where: { placeId } })) >= MAX_PLACE_PHOTOS) {
      return placeFail('invalid', `A community can have up to ${MAX_PLACE_PHOTOS} photos. Remove one first.`);
    }
    const id = newId();
    const statements: SqlStatement[] = [
      {
        sql: 'INSERT INTO place_photos (id, shop_id, place_id, photo_key, kind, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
        params: [id, shopId, placeId, photoKey, kind, byUserId],
      },
    ];
    if (!place.photoKey) {
      statements.push({
        sql: `UPDATE places SET photo_key = ?, updated_at = ${SQL_NOW} WHERE shop_id = ? AND id = ?`,
        params: [photoKey, shopId, placeId],
      });
    }
    await runStatements(d1, statements);
    return { id };
  },

  async photoKeyOf(db: DbClient, placeId: string, photoId: string): Promise<string | null> {
    const row = await db.placePhoto.findFirst({ where: { id: photoId, placeId }, select: { photoKey: true } });
    return row?.photoKey ?? null;
  },

  /** Removes a photo (returns its key for the caller to delete); the cover moves to the next one. */
  async removePhoto(d1: D1Database, shopId: string, placeId: string, photoId: string): Promise<string | null> {
    const db = createShopDb(d1, shopId);
    const [row, place] = await Promise.all([
      db.placePhoto.findFirst({ where: { id: photoId, placeId }, select: { photoKey: true } }),
      db.place.findUnique({ where: { id: placeId }, select: { photoKey: true } }),
    ]);
    if (!row || !place) return null;
    const statements: SqlStatement[] = [{ sql: 'DELETE FROM place_photos WHERE shop_id = ? AND id = ?', params: [shopId, photoId] }];
    if (place.photoKey === row.photoKey) {
      const next = await db.placePhoto.findFirst({
        where: { placeId, id: { not: photoId } },
        orderBy: { createdAt: 'asc' },
        select: { photoKey: true },
      });
      statements.push({
        sql: `UPDATE places SET photo_key = ?, updated_at = ${SQL_NOW} WHERE shop_id = ? AND id = ?`,
        params: [next?.photoKey ?? null, shopId, placeId],
      });
    }
    await runStatements(d1, statements);
    return row.photoKey;
  },

  async update(d1: D1Database, shopId: string, id: string, patch: Partial<PlaceInput> & { status?: PlaceStatus }) {
    const place = await createShopDb(d1, shopId).place.findUnique({ where: { id }, select: placeSelect });
    if (!place) return placeFail('not_found', 'Place not found.');
    await runStatements(d1, [
      {
        sql: `UPDATE places SET type = ?, name = ?, label = ?, latitude = ?, longitude = ?, wash_days = ?, wash_time = ?,
                needs_approval = ?, capacity = ?, status = ?, updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ?`,
        params: [
          patch.type ?? place.type,
          patch.name !== undefined ? patch.name : place.name,
          patch.label ?? place.label,
          patch.latitude ?? place.latitude,
          patch.longitude ?? place.longitude,
          patch.washDays ? formatWashDays(patch.washDays) : place.washDays,
          patch.washTime ?? place.washTime,
          patch.needsApproval ?? place.needsApproval,
          patch.capacity !== undefined ? patch.capacity : place.capacity,
          patch.status ?? place.status,
          shopId,
          id,
        ],
      },
    ]);
  },

  async setPhoto(d1: D1Database, shopId: string, id: string, photoKey: string): Promise<string | null> {
    const place = await createShopDb(d1, shopId).place.findUnique({ where: { id }, select: { photoKey: true } });
    if (!place) return placeFail('not_found', 'Place not found.');
    await runStatements(d1, [
      { sql: `UPDATE places SET photo_key = ?, updated_at = ${SQL_NOW} WHERE shop_id = ? AND id = ?`, params: [photoKey, shopId, id] },
    ]);
    return place.photoKey;
  },

  /** The branch's places with how many members and paying vehicles each has. */
  async list(d1: D1Database, shopId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const [places, members, orders, people, photos] = await Promise.all([
      db.place.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], select: { ...placeSelect, ...setupSelect } }),
      db.placeMember.groupBy({ by: ['placeId', 'status'], where: { status: LIVE_MEMBER }, _count: { _all: true } }),
      db.placeOrder.findMany({
        where: { status: { in: ['awaiting_payment', 'active', 'waitlist'] } },
        select: { status: true, member: { select: { placeId: true } } },
      }),
      peopleOf(db),
      db.placePhoto.groupBy({ by: ['placeId', 'kind'], _count: { _all: true } }),
    ]);
    const count = (placeId: string, status: string) =>
      members.find((m) => m.placeId === placeId && m.status === status)?._count._all ?? 0;
    return places.map((p) => {
      const mine = orders.filter((o) => o.member.placeId === p.id);
      const mineP = photos.filter((x) => x.placeId === p.id);
      const photoCount = mineP.reduce((n, x) => n + x._count._all, 0);
      return {
        ...placeView(p, now),
        setup: setupView(p, people, mineP.map((x) => x.kind as PlacePhotoKind)),
        photos: photoCount,
        members: count(p.id, 'active'),
        pending: count(p.id, 'pending'),
        washing: mine.filter((o) => o.status === 'active').length,
        unpaid: mine.filter((o) => o.status === 'awaiting_payment').length,
        waitlist: mine.filter((o) => o.status === 'waitlist').length,
      };
    });
  },

  async find(db: DbClient, id: string) {
    return db.place.findUnique({ where: { id }, select: placeSelect });
  },

  async photoKey(pdb: DbClient, id: string): Promise<string | null> {
    const place = await pdb.place.findUnique({ where: { id }, select: { photoKey: true, status: true, stage: true } });
    return place && place.status !== 'closed' && place.stage === 'live' ? place.photoKey : null;
  },

  async units(db: DbClient, placeId: string) {
    const units = await db.placeUnit.findMany({
      where: { placeId, archivedAt: null },
      select: { id: true, block: true, number: true },
    });
    return units.sort((a, b) => compareUnits(a.block ?? '', b.block ?? '') || compareUnits(a.number, b.number));
  },

  /** Adds flats; ones already there are left alone. Returns how many were new. */
  async addUnits(d1: D1Database, shopId: string, placeId: string, block: string | null, numbers: string[]): Promise<number> {
    const db = createShopDb(d1, shopId);
    if (!(await db.place.findUnique({ where: { id: placeId }, select: { id: true } }))) {
      return placeFail('not_found', 'Place not found.');
    }
    const before = await db.placeUnit.count({ where: { placeId, archivedAt: null } });
    const b = block ? normalizeUnit(block) : null;
    await runStatements(
      d1,
      insertRows(
        'place_units',
        ['id', 'shop_id', 'place_id', 'block', 'number'],
        numbers.map((n) => [newId(), shopId, placeId, b, normalizeUnit(n)]),
        { orIgnore: true },
      ),
    );
    return (await db.placeUnit.count({ where: { placeId, archivedAt: null } })) - before;
  },

  async archiveUnit(d1: D1Database, shopId: string, placeId: string, unitId: string): Promise<boolean> {
    const { count } = await createShopDb(d1, shopId).placeUnit.updateMany({
      where: { id: unitId, placeId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return count === 1;
  },

  /** Members of a place (live ones, or those who left/were removed), newest first. */
  async members(d1: D1Database, shopId: string, placeId: string, filter: 'live' | 'past', now: Date) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id: placeId }, select: { washDays: true } });
    if (!place) return placeFail('not_found', 'Place not found.');
    const [{ rules }, rows] = await Promise.all([
      shopContext(createPlatformDb(d1), shopId),
      db.placeMember.findMany({
        where: { placeId, status: filter === 'live' ? LIVE_MEMBER : { in: ['left', 'removed'] } },
        orderBy: { createdAt: 'desc' },
        take: filter === 'live' ? 1000 : 200,
        select: memberSelect,
      }),
    ]);
    const views = (rows as MemberRow[]).map((m) => memberView(m, place.washDays, rules, now));
    // Who needs the team first, then by flat.
    return views.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || compareUnits(a.unit, b.unit));
  },

  async member(d1: D1Database, shopId: string, memberId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const m = (await db.placeMember.findUnique({ where: { id: memberId }, select: memberSelect })) as MemberRow | null;
    if (!m) return null;
    const place = await db.place.findUnique({ where: { id: m.placeId }, select: { washDays: true } });
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    return memberView(m, place?.washDays ?? '', rules, now);
  },

  /** The team confirms a member who joined away from the place (or needed the society's yes). */
  async approve(d1: D1Database, shopId: string, memberId: string, byUserId: string): Promise<boolean> {
    const { count } = await createShopDb(d1, shopId).placeMember.updateMany({
      where: { id: memberId, status: 'pending' },
      data: { status: 'active', checks: null, handledByUserId: byUserId, handledAt: new Date() },
    });
    return count === 1;
  },

  /** Clears "please check" notes on an active member (the team looked). */
  async clearChecks(d1: D1Database, shopId: string, memberId: string, byUserId: string): Promise<boolean> {
    const { count } = await createShopDb(d1, shopId).placeMember.updateMany({
      where: { id: memberId, status: 'active' },
      data: { checks: null, handledByUserId: byUserId, handledAt: new Date() },
    });
    return count === 1;
  },

  async setParkingNote(d1: D1Database, shopId: string, memberId: string, note: string | null): Promise<boolean> {
    const { count } = await createShopDb(d1, shopId).placeMember.updateMany({
      where: { id: memberId, status: LIVE_MEMBER },
      data: { parkingNote: note },
    });
    return count === 1;
  },

  /**
   * Ends a membership (the team removed them, or they moved out). Returns the live orders, which
   * the caller cancels (with refunds) — money is never touched here.
   */
  /** Whether a member has a paid plan running (removing them would refund it). */
  async hasLivePlan(db: DbClient, memberId: string): Promise<boolean> {
    return (await db.placeOrder.count({ where: { memberId, status: 'active' } })) > 0;
  },

  async end(
    d1: D1Database,
    shopId: string,
    memberId: string,
    data: { status: 'removed' | 'left'; reason: string | null; byUserId: string | null },
  ): Promise<{ orderIds: string[] } | null> {
    const db = createShopDb(d1, shopId);
    const now = new Date();
    const { count } = await db.placeMember.updateMany({
      where: { id: memberId, status: LIVE_MEMBER },
      data: { status: data.status, endedAt: now, endReason: data.reason, handledByUserId: data.byUserId, handledAt: now },
    });
    if (count !== 1) return null;
    const orders = await db.placeOrder.findMany({ where: { memberId, status: LIVE_ORDER }, select: { id: true } });
    return { orderIds: orders.map((o) => o.id) };
  },

  /** Adds a "please check" note (vehicle not found) and sends the member back to the team. */
  async flag(d1: D1Database, shopId: string, memberId: string, check: MemberCheck) {
    const db = createShopDb(d1, shopId);
    const m = await db.placeMember.findUnique({ where: { id: memberId }, select: { checks: true, status: true } });
    if (!m || (m.status !== 'active' && m.status !== 'pending')) return;
    const checks = [...new Set([...parseMemberChecks(m.checks), check])];
    await db.placeMember.updateMany({
      where: { id: memberId, status: LIVE_MEMBER },
      data: { checks: checks.join(','), status: 'pending', handledAt: null, handledByUserId: null },
    });
  },

  /**
   * One place's wash day: every vehicle due that day (and any already recorded), with whether
   * it is paid. Vehicles waiting for their first payment show as "Not paid" so the washer knows
   * to skip them.
   */
  async washDay(d1: D1Database, shopId: string, placeId: string, day: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id: placeId }, select: placeSelect });
    if (!place) return placeFail('not_found', 'Place not found.');
    const [{ rules }, orders, people] = await Promise.all([
      shopContext(createPlatformDb(d1), shopId),
      loadDayOrders(db, {
        member: { placeId, status: 'active' },
        OR: [{ status: { in: ['active', 'awaiting_payment'] } }, { visits: { some: { date: day } } }],
      }),
      peopleOf(db),
    ]);
    const washDays = parseWashDays(place.washDays);
    const rows = orders.flatMap((o) => {
      const visit = dueVisit(o, washDays, day);
      if (visit === false) return [];
      const phase = phaseOf(o, rules, day);
      return [
        {
          orderId: o.id,
          memberId: o.member.id,
          unit: unitOf(o.member),
          customer: o.member.customer,
          parkingNote: o.member.parkingNote,
          memberVehicleId: o.memberVehicle.id,
          vehicle: {
            typeName: o.memberVehicle.vehicleType.name,
            category: o.memberVehicle.vehicleType.category === 'bike' ? ('bike' as const) : ('car' as const),
            registrationNumber: o.memberVehicle.vehicle?.registrationNumber ?? null,
            make: o.memberVehicle.vehicle?.make ?? null,
            model: o.memberVehicle.vehicle?.model ?? null,
          },
          title: o.title,
          kind: o.kind,
          phase,
          /** Never wash a vehicle that isn't paid. */
          paid: phase === 'active' || phase === 'payment_due',
          firstWash: o.washesUsed === 0,
          washesLeft: o.washesTotal - o.washesUsed,
          washNo: visit?.outcome === 'done' ? o.washesUsed : o.washesUsed + 1,
          washesTotal: o.washesTotal,
          /** On plans with a better wash every few washes: which one this is ("Premium Wash"). */
          planWash: o.kind === 'plan' ? planWashOf(o.snapshot, visit?.outcome === 'done' ? o.washesUsed : o.washesUsed + 1) : null,
          visit: visit
            ? {
                id: visit.id,
                outcome: visit.outcome as VisitOutcome,
                byCustomer: visit.byCustomer,
                note: visit.note,
                by: visit.byUserId ? (people.get(visit.byUserId) ?? null) : null,
                at: visit.createdAt.toISOString(),
                hasPhoto: visit.photoKey != null,
                distanceM: visit.distanceM,
                /** The washer's phone was too far from the community when they recorded it. */
                far: visit.distanceM != null && visit.distanceM > rules.atPlaceMeters,
              }
            : null,
        },
      ];
    });
    rows.sort((a, b) => compareUnits(a.unit, b.unit));
    return { place: placeView(place, now), day, rows, atPlaceMeters: rules.atPlaceMeters };
  },

  /**
   * Every live community over the coming days: who is due and, for days already started, how
   * far the team got. One read of the orders serves the whole week.
   */
  async overview(d1: D1Database, shopId: string, from: string, days: number, now: Date) {
    const db = createShopDb(d1, shopId);
    const to = addDaysTo(from, days - 1);
    const [{ rules }, places, people, review] = await Promise.all([
      shopContext(createPlatformDb(d1), shopId),
      db.place.findMany({ where: PUBLIC_PLACE, select: { ...placeSelect, teamUserIds: true }, orderBy: { washTime: 'asc' } }),
      peopleOf(db),
      db.place.count({ where: { stage: 'review', status: { not: 'closed' } } }),
    ]);
    const orders = places.length
      ? await loadDayOrders(db, {
          member: { placeId: { in: places.map((p) => p.id) }, status: 'active' },
          OR: [{ status: { in: ['active', 'awaiting_payment'] } }, { visits: { some: { date: { gte: from, lte: to } } } }],
        })
      : [];
    const byPlace = new Map<string, DayOrder[]>();
    for (const o of orders) byPlace.set(o.member.placeId, [...(byPlace.get(o.member.placeId) ?? []), o]);

    const dayList = Array.from({ length: days }, (_, i) => addDaysTo(from, i));
    return {
      today: istDay(now),
      /** Communities waiting for the owner's approval. */
      review,
      days: dayList.map((day) => ({
        day,
        places: places.flatMap((p) => {
          const washDays = parseWashDays(p.washDays);
          const due = (byPlace.get(p.id) ?? []).flatMap((o) => {
            const visit = dueVisit(o, washDays, day);
            if (visit === false) return [];
            const phase = phaseOf(o, rules, day);
            return [{ visit, paid: phase === 'active' || phase === 'payment_due' }];
          });
          if (!due.length && !washDays.includes(weekdayOf(day))) return [];
          const visits = due.flatMap((d) => (d.visit && !d.visit.byCustomer ? [d.visit] : []));
          const times = visits.map((v) => v.createdAt.getTime());
          return [
            {
              id: p.id,
              title: p.name || p.label,
              label: p.label,
              washTime: p.washTime,
              /** Paid vehicles to wash. */
              due: due.filter((d) => d.paid).length,
              unpaid: due.filter((d) => !d.paid && !d.visit).length,
              done: visits.filter((v) => v.outcome === 'done').length,
              notFound: visits.filter((v) => v.outcome === 'not_found').length,
              missed: visits.filter((v) => v.outcome === 'missed').length,
              far: visits.filter((v) => v.distanceM != null && v.distanceM > rules.atPlaceMeters).length,
              startedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
              lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
              washers: [...new Set(visits.flatMap((v) => (v.byUserId && people.has(v.byUserId) ? [people.get(v.byUserId)!] : [])))],
              team: parseTeam(p.teamUserIds).flatMap((id) => (people.has(id) ? [people.get(id)!] : [])),
            },
          ];
        }),
      })),
    };
  },

  /**
   * Open "Call me back" requests grouped by where they are: where people want us, biggest group
   * first. Requests already invited to a place are left out.
   */
  async demand(d1: D1Database, shopId: string) {
    const db = createShopDb(d1, shopId);
    const requests = await db.serviceRequest.findMany({
      where: { status: { in: [...OPEN_REQUEST_STATUSES] }, invitedPlaceId: null },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        latitude: true,
        longitude: true,
        cars: true,
        bikes: true,
        address: true,
        placeName: true,
        createdAt: true,
        area: { select: { name: true } },
      },
    });
    const located = requests.flatMap((r) =>
      r.latitude != null && r.longitude != null ? [{ ...r, latitude: r.latitude, longitude: r.longitude }] : [],
    );
    return {
      clusters: clusterPoints(located, INTEREST_RADIUS_M).map((g) => ({
        center: g.center,
        requests: g.items.length,
        cars: g.items.reduce((n, r) => n + r.cars, 0),
        bikes: g.items.reduce((n, r) => n + r.bikes, 0),
        landmarks: [...new Set(g.items.map((r) => r.placeName || r.address).filter((x): x is string => !!x))].slice(0, 5),
        latestAt: g.items[0]!.createdAt.toISOString(),
        requestIds: g.items.map((r) => r.id),
      })),
      /** Requests that only picked an area. */
      byArea: Object.entries(
        requests
          .filter((r) => r.latitude == null)
          .reduce<Record<string, number>>((acc, r) => {
            const key = r.area?.name ?? 'No location';
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
      )
        .map(([area, count]) => ({ area, requests: count }))
        .sort((a, b) => b.requests - a.requests),
    };
  },

  /** Open requests near a place get invited to join it in one tap. Returns how many. */
  async invite(d1: D1Database, shopId: string, placeId: string, radiusM = INTEREST_RADIUS_M): Promise<number> {
    const db = createShopDb(d1, shopId);
    const place = await db.place.findUnique({ where: { id: placeId }, select: { latitude: true, longitude: true, status: true, stage: true } });
    if (!place) return placeFail('not_found', 'Place not found.');
    if (place.status !== 'active' || place.stage !== 'live') return 0;
    const span = radiusM / 111_000 + 0.001;
    const nearby = await db.serviceRequest.findMany({
      where: {
        status: { in: [...OPEN_REQUEST_STATUSES] },
        invitedPlaceId: null,
        latitude: { gte: place.latitude - span, lte: place.latitude + span },
        longitude: { gte: place.longitude - span * 1.2, lte: place.longitude + span * 1.2 },
      },
      select: { id: true, latitude: true, longitude: true },
    });
    const ids = nearby
      .filter((r) => distanceMeters(place, { latitude: r.latitude!, longitude: r.longitude! }) <= radiusM)
      .map((r) => r.id);
    if (!ids.length) return 0;
    const { count } = await db.serviceRequest.updateMany({ where: { id: { in: ids }, invitedPlaceId: null }, data: { invitedPlaceId: placeId } });
    return count;
  },

  // ---------- Before joining (platform client: public) ----------

  /** Active places of listed branches near a point, nearest first. */
  async nearby(pdb: DbClient, point: GeoPoint, now: Date) {
    const span = NEARBY_PLACES_KM / 111 + 0.005;
    const lngSpan = span / Math.max(0.2, Math.cos((point.latitude * Math.PI) / 180));
    const places = await pdb.place.findMany({
      where: {
        ...PUBLIC_PLACE,
        latitude: { gte: point.latitude - span, lte: point.latitude + span },
        longitude: { gte: point.longitude - lngSpan, lte: point.longitude + lngSpan },
      },
      select: placeSelect,
      take: 300,
    });
    const shops = await pdb.shop.findMany({
      where: { id: { in: [...new Set(places.map((p) => p.shopId))] }, inCustomerApp: true, status: 'active' },
      select: { id: true, name: true },
    });
    const listed = new Map(shops.map((s) => [s.id, s.name]));
    return places
      .filter((p) => listed.has(p.shopId))
      .map((p) => ({ ...placeView(p, now), distanceM: distanceMeters(point, p), branchName: listed.get(p.shopId)! }))
      .filter((p) => p.distanceM <= NEARBY_PLACES_KM * 1000)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, NEARBY_PLACES_MAX);
  },

  /** A place from its QR poster or invite link; null when unknown or closed. */
  async byCode(pdb: DbClient, code: string) {
    const place = await pdb.place.findUnique({ where: { code }, select: placeSelect });
    if (!place || place.status === 'closed' || place.stage !== 'live') return null;
    const shop = await pdb.shop.findUnique({ where: { id: place.shopId }, select: { inCustomerApp: true, status: true, name: true } });
    return shop?.inCustomerApp && shop.status === 'active' ? { place, branchName: shop.name } : null;
  },

  async publicFind(pdb: DbClient, id: string) {
    const place = await pdb.place.findUnique({ where: { id }, select: placeSelect });
    if (!place || place.status === 'closed' || place.stage !== 'live') return null;
    const shop = await pdb.shop.findUnique({ where: { id: place.shopId }, select: { inCustomerApp: true, status: true, name: true } });
    return shop?.inCustomerApp && shop.status === 'active' ? { place, branchName: shop.name } : null;
  },

  // ---------- The customer (their own memberships) ----------

  /** Every live membership of this customer across their branches, with each vehicle's orders. */
  async mine(d1: D1Database, links: CustomerLink[], now: Date) {
    const pdb = createPlatformDb(d1);
    const out = [];
    for (const link of links) {
      const db = createShopDb(d1, link.shopId);
      const rows = (await db.placeMember.findMany({
        where: { customerId: link.customerId, status: LIVE_MEMBER },
        orderBy: { createdAt: 'asc' },
        select: { ...memberSelect, place: { select: placeSelect } },
      })) as (MemberRow & { place: PlaceRow })[];
      if (!rows.length) continue;
      const shop = await pdb.shop.findUnique({ where: { id: link.shopId }, select: { businessId: true, contactPhone: true } });
      const rules = await businessRules(pdb, shop?.businessId ?? null);
      for (const m of rows) {
        out.push({
          ...memberView(m, m.place.washDays, rules, now),
          place: placeView(m.place, now),
          branch: { id: link.shopId, name: link.shopName, phone: shop?.contactPhone ?? null },
        });
      }
    }
    return out;
  },
};
