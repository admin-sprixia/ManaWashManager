import {
  parsePlanSoldAt,
  soldAtCommunities,
  soldAtShop,
  type PlanSoldAt,
  communityJoin,
  communityPrice,
  fixedPlanPrice,
  istDay,
  istInstant,
  normalizeUnit,
  type CommunityJoin,
  parseChecklist,
  parseServiceKind,
  parseServiceModes,
  parseTeamPlaces,
  servicePlaces,
  serializeWashPlanRules,
  upgradeWashes,
  washesPerWeek,
  washPlanPrice,
  planPriceWithSaving,
  scaledPlanPrice,
  listPrice,
  parsePricingPolicy,
  type DeliveryMode,
  type ModeAdjustment,
  type PlacePriceMode,
  type ServiceKind,
  type WashPlanRules,
} from '@mana/domain';
import { createPlatformDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import { awayPricingRepo } from './awayPricingRepo';
import { businessRules, placeFail } from './placeShared';

/**
 * Wash plans (monthly, quarterly, yearly) are set up once for the business; each wash is one
 * catalog service, and a plan can make every Nth wash a better one (Shine: every 4th is
 * Premium). A plan priced for a vehicle size (hub and community) charges that, moved by the
 * branch's zone; otherwise it's the wash's branch price (doorstep or hub, by the business rule)
 * × washes, less the plan's discount. Plans are switched off, never deleted, because orders
 * point at them.
 */

export interface WashPlanPriceInput {
  sizeId: string;
  mode: DeliveryMode;
  price: number;
}

export interface WashPlanInput {
  name: string;
  washes: number;
  months: number;
  catalogServiceId: string;
  discountBp: number;
  allowParts: boolean;
  popular: boolean;
  upgradeServiceId: string | null;
  upgradeEvery: number | null;
  /** Where it's sold: communities, the shop counter, or both. */
  soldAt: PlanSoldAt;
  /** A community plan can also pay for a wash at the shop. */
  shopUse: boolean;
  /** Replaces every fixed price of the plan when given. */
  prices?: WashPlanPriceInput[];
}

export interface WashPlanView extends Omit<WashPlanInput, 'prices'> {
  id: string;
  active: boolean;
  sortOrder: number;
  serviceName: string | null;
  upgradeServiceName: string | null;
  perWeek: number;
  prices: WashPlanPriceInput[];
}

/** Only one active plan is "Most popular": marking one clears the rest in the same batch. */
const clearPopular = (businessId: string, exceptId: string): SqlStatement => ({
  sql: 'UPDATE wash_plans SET popular = 0 WHERE business_id = ? AND id != ? AND popular = 1',
  params: [businessId, exceptId],
});

async function checkService(
  pdb: DbClient,
  businessId: string,
  serviceId: string,
  soldAt: PlanSoldAt,
  message = 'Pick the wash this plan includes.',
) {
  const service = await pdb.catalogService.findFirst({
    where: { id: serviceId, businessId, active: true },
    select: { id: true, name: true, modes: true, teamAt: true },
  });
  if (!service) return placeFail('invalid', message);
  // A plan's wash must be done where the plan is sold, or it would never show.
  const places = servicePlaces(parseServiceModes(service.modes), parseTeamPlaces(service.teamAt));
  if (soldAtCommunities(soldAt) && !places.community) {
    placeFail('invalid', `${service.name} isn’t done at communities. Tick Community for it in Services first.`);
  }
  if (soldAtShop(soldAt) && !places.shop) {
    placeFail('invalid', `${service.name} isn’t done at the shop. Tick Shop for it in Services first.`);
  }
}

async function checkUpgrade(
  pdb: DbClient,
  businessId: string,
  plan: { catalogServiceId: string; upgradeServiceId: string | null; upgradeEvery: number | null; soldAt: PlanSoldAt },
) {
  if ((plan.upgradeServiceId == null) !== (plan.upgradeEvery == null)) placeFail('invalid', 'Pick the better wash and how often it comes.');
  if (!plan.upgradeServiceId) return;
  if (plan.upgradeServiceId === plan.catalogServiceId) placeFail('invalid', 'The better wash must be a different wash.');
  await checkService(pdb, businessId, plan.upgradeServiceId, plan.soldAt, 'Pick the better wash again.');
}

async function checkPrices(pdb: DbClient, businessId: string, prices: WashPlanPriceInput[] | undefined) {
  if (!prices?.length) return;
  const keys = new Set(prices.map((p) => `${p.sizeId}|${p.mode}`));
  if (keys.size !== prices.length) placeFail('invalid', 'A size has two prices.');
  const known = await pdb.vehicleSize.count({ where: { businessId, id: { in: [...new Set(prices.map((p) => p.sizeId))] } } });
  if (known !== new Set(prices.map((p) => p.sizeId)).size) placeFail('invalid', 'Unknown vehicle size.');
}

function priceStatements(businessId: string, planId: string, prices: WashPlanPriceInput[] | undefined): SqlStatement[] {
  if (!prices) return [];
  return [
    { sql: 'DELETE FROM wash_plan_prices WHERE business_id = ? AND plan_id = ?', params: [businessId, planId] },
    ...insertRows(
      'wash_plan_prices',
      ['business_id', 'plan_id', 'size_id', 'mode', 'price'],
      prices.map((p) => [businessId, planId, p.sizeId, p.mode, p.price]),
    ),
  ];
}

/** A branch's price list as plans and one-time washes see it. */
export interface PlaceMenu {
  priceMode: PlacePriceMode;
  /**
   * For one community: how many of its flats wash with us and the neighbours discount that gives,
   * already taken off every price here (never below the hub price). Null at the shop counter, or
   * for the branch's prices with no community.
   */
  join: CommunityJoin | null;
  vehicleTypes: { id: string; name: string; category: 'car' | 'bike'; bodyKey: string | null }[];
  plans: {
    id: string;
    name: string;
    washes: number;
    months: number;
    perWeek: number;
    discountBp: number;
    allowParts: boolean;
    popular: boolean;
    serviceName: string;
    /** Every Nth wash is this better one (Shine: every 4th is Premium); null = all the same. */
    upgrade: { every: number; name: string; catalogServiceId: string } | null;
    /**
     * Per vehicle type: the one-wash price, the plan price, and what its washes would cost one
     * by one (to show the saving); `fullTotal` is the plan price before the neighbours discount.
     * Types the plan can't serve are absent.
     */
    prices: { vehicleTypeId: string; perWash: number; total: number; listTotal: number; fullTotal: number }[];
  }[];
  services: {
    id: string;
    name: string;
    description: string | null;
    includes: string[];
    durationMin: number | null;
    kind: ServiceKind;
    popular: boolean;
    /** False = staff sell it; the customer app doesn't offer it. */
    showInApp: boolean;
    checklist: string[];
    /** `full` is the price before the neighbours discount (the same when there's none). */
    prices: { vehicleTypeId: string; price: number; full: number }[];
  }[];
}

/**
 * Per-wash prices at head office's Standard (default) price book, worked out the way a branch's
 * list prices are (community rule, rounding) but with no zone, own prices or volume discount: the
 * prices head office set its plans' fixed prices against. Returns a lookup by service and size.
 */
async function standardPrices(
  pdb: DbClient,
  businessId: string,
  plans: readonly { catalogServiceId: string; upgradeServiceId: string | null }[],
  mode: PlacePriceMode,
): Promise<(catalogServiceId: string, sizeId: string) => number | null> {
  const serviceIds = [...new Set(plans.flatMap((p) => [p.catalogServiceId, p.upgradeServiceId]).filter((id): id is string => !!id))];
  if (!serviceIds.length) return () => null;
  const [book, sizes, classes, rules, rounding] = await Promise.all([
    pdb.priceBook.findFirst({ where: { businessId, isDefault: true }, select: { id: true } }),
    pdb.vehicleSize.findMany({ where: { businessId }, select: { id: true, classId: true } }),
    pdb.vehicleClass.findMany({ where: { businessId }, select: { id: true, key: true } }),
    pdb.modeAdjustment.findMany({ where: { businessId } }),
    pdb.businessSetting.findFirst({ where: { businessId, key: 'pricing.roundToPaise' }, select: { value: true } }),
  ]);
  if (!book) return () => null;
  const entries = await pdb.priceBookEntry.findMany({
    where: { priceBookId: book.id, serviceId: { in: serviceIds } },
    select: { serviceId: true, sizeId: true, price: true, doorstepPrice: true },
  });
  const classKey = new Map(classes.map((c) => [c.id, c.key]));
  const classOfSize = new Map(sizes.map((s) => [s.id, classKey.get(s.classId) ?? null]));
  const adjustments: ModeAdjustment[] = rules.map((a) => ({
    mode: a.mode === 'doorstep' ? 'doorstep' : 'hub',
    classKey: a.classId ? (classKey.get(a.classId) ?? null) : null,
    percentBp: a.percentBp,
    fixedPaise: a.fixedPaise,
    minExtraPaise: a.minExtraPaise,
  }));
  const roundToPaise = parsePricingPolicy({ roundToPaise: rounding?.value }).roundToPaise;
  const entry = new Map(entries.map((e) => [`${e.serviceId}|${e.sizeId}`, e]));
  return (catalogServiceId, sizeId) => {
    const e = entry.get(`${catalogServiceId}|${sizeId}`);
    const cls = classOfSize.get(sizeId);
    if (!e || e.price <= 0 || !cls) return null;
    return listPrice({ base: e.price, mode, classKey: cls, adjustments, zonePercentBp: 0, roundToPaise, doorstepBase: e.doorstepPrice }).price;
  };
}

export const planRepo = {
  /**
   * Whether the customer already has a plan running at this branch on another vehicle (a shop
   * plan, or a community plan waiting, due or active): their next car is the second car at home.
   */
  async customerHasPlan(db: DbClient, customerId: string, exceptVehicleId?: string | null): Promise<boolean> {
    const [shop, place] = await Promise.all([
      db.shopPlanOrder.count({
        where: { customerId, status: 'active', ...(exceptVehicleId ? { vehicleId: { not: exceptVehicleId } } : {}) },
      }),
      db.placeOrder.findMany({
        where: { customerId, kind: 'plan', status: { in: ['waitlist', 'awaiting_payment', 'active'] } },
        select: { memberVehicleId: true },
      }),
    ]);
    if (shop > 0) return true;
    if (!place.length) return false;
    if (!exceptVehicleId) return true;
    const vehicles = await db.memberVehicle.findMany({
      where: { id: { in: place.map((o) => o.memberVehicleId) } },
      select: { vehicleId: true },
    });
    return vehicles.some((v) => v.vehicleId !== exceptVehicleId);
  },

  async list(pdb: DbClient, businessId: string, options: { activeOnly?: boolean } = {}): Promise<WashPlanView[]> {
    const plans = await pdb.washPlan.findMany({
      where: { businessId, ...(options.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const serviceIds = [...new Set(plans.flatMap((p) => [p.catalogServiceId, p.upgradeServiceId]).filter((id): id is string => !!id))];
    const [services, prices] = plans.length
      ? await Promise.all([
          pdb.catalogService.findMany({ where: { businessId, id: { in: serviceIds } }, select: { id: true, name: true } }),
          pdb.washPlanPrice.findMany({
            where: { businessId, planId: { in: plans.map((p) => p.id) } },
            select: { planId: true, sizeId: true, mode: true, price: true },
          }),
        ])
      : [[], []];
    const names = new Map(services.map((s) => [s.id, s.name]));
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      washes: p.washes,
      months: p.months,
      catalogServiceId: p.catalogServiceId,
      serviceName: names.get(p.catalogServiceId) ?? null,
      upgradeServiceId: p.upgradeServiceId,
      upgradeServiceName: p.upgradeServiceId ? (names.get(p.upgradeServiceId) ?? null) : null,
      upgradeEvery: p.upgradeEvery,
      discountBp: p.discountBp,
      allowParts: p.allowParts,
      popular: p.popular,
      soldAt: parsePlanSoldAt(p.soldAt),
      shopUse: p.shopUse,
      active: p.active,
      sortOrder: p.sortOrder,
      perWeek: washesPerWeek(p.washes, p.months),
      prices: prices
        .filter((x) => x.planId === p.id)
        .map((x) => ({ sizeId: x.sizeId, mode: x.mode === 'doorstep' ? ('doorstep' as const) : ('hub' as const), price: x.price })),
    }));
  },

  async create(d1: D1Database, businessId: string, input: WashPlanInput): Promise<string> {
    const pdb = createPlatformDb(d1);
    await checkService(pdb, businessId, input.catalogServiceId, input.soldAt);
    await checkUpgrade(pdb, businessId, input);
    await checkPrices(pdb, businessId, input.prices);
    const count = await pdb.washPlan.count({ where: { businessId } });
    const id = newId();
    await runStatements(d1, [
      ...(input.popular ? [clearPopular(businessId, id)] : []),
      {
        sql: `INSERT INTO wash_plans (id, business_id, name, washes, months, catalog_service_id, discount_bp, allow_parts, popular,
                sort_order, upgrade_service_id, upgrade_every, sold_at, shop_use)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          businessId,
          input.name,
          input.washes,
          input.months,
          input.catalogServiceId,
          input.discountBp,
          input.allowParts,
          input.popular,
          count,
          input.upgradeServiceId,
          input.upgradeEvery,
          input.soldAt,
          input.shopUse,
        ],
      },
      ...priceStatements(businessId, id, input.prices),
    ]);
    return id;
  },

  async update(
    d1: D1Database,
    businessId: string,
    id: string,
    patch: Partial<WashPlanInput> & { active?: boolean; sortOrder?: number },
  ): Promise<void> {
    const pdb = createPlatformDb(d1);
    const plan = await pdb.washPlan.findFirst({ where: { id, businessId } });
    if (!plan) return placeFail('not_found', 'Plan not found.');
    const soldAt = patch.soldAt ?? parsePlanSoldAt(plan.soldAt);
    const next = {
      catalogServiceId: patch.catalogServiceId ?? plan.catalogServiceId,
      upgradeServiceId: patch.upgradeServiceId !== undefined ? patch.upgradeServiceId : plan.upgradeServiceId,
      upgradeEvery: patch.upgradeEvery !== undefined ? patch.upgradeEvery : plan.upgradeEvery,
      soldAt,
    };
    if (patch.catalogServiceId || patch.soldAt) await checkService(pdb, businessId, next.catalogServiceId, soldAt);
    if (patch.catalogServiceId || patch.upgradeServiceId !== undefined || patch.soldAt) await checkUpgrade(pdb, businessId, next);
    await checkPrices(pdb, businessId, patch.prices);
    const active = patch.active ?? plan.active;
    const popular = active && (patch.popular ?? plan.popular);
    await runStatements(d1, [
      ...(popular ? [clearPopular(businessId, id)] : []),
      {
        sql: `UPDATE wash_plans SET name = ?, washes = ?, months = ?, catalog_service_id = ?, discount_bp = ?,
                allow_parts = ?, popular = ?, active = ?, sort_order = ?, upgrade_service_id = ?, upgrade_every = ?,
                sold_at = ?, shop_use = ?, updated_at = ${SQL_NOW}
              WHERE business_id = ? AND id = ?`,
        params: [
          patch.name ?? plan.name,
          patch.washes ?? plan.washes,
          patch.months ?? plan.months,
          next.catalogServiceId,
          patch.discountBp ?? plan.discountBp,
          patch.allowParts ?? plan.allowParts,
          popular,
          active,
          patch.sortOrder ?? plan.sortOrder,
          next.upgradeServiceId,
          next.upgradeEvery,
          soldAt,
          patch.shopUse ?? plan.shopUse,
          businessId,
          id,
        ],
      },
      ...priceStatements(businessId, id, patch.prices),
    ]);
  },

  rules: businessRules,

  async setRules(d1: D1Database, businessId: string, patch: Partial<WashPlanRules>, phone: string | null) {
    const pairs = serializeWashPlanRules(patch);
    const set = pairs.filter((p): p is [string, string] => p[1] != null);
    const cleared = pairs.filter(([, v]) => v == null).map(([k]) => k);
    await runStatements(d1, [
      ...insertRows(
        'business_settings',
        ['business_id', 'key', 'value', 'updated_by_phone'],
        set.map(([key, value]) => [businessId, key, value, phone]),
        {
          onConflict: `ON CONFLICT (business_id, key) DO UPDATE SET value = excluded.value,
            updated_by_phone = excluded.updated_by_phone, updated_at = ${SQL_NOW}`,
        },
      ),
      ...cleared.map((key) => ({ sql: 'DELETE FROM business_settings WHERE business_id = ? AND key = ?', params: [businessId, key] })),
    ]);
  },

  /**
   * How much of a community washes with us: flats with a plan running, or a one-time wash booked
   * this month (IST), out of the flats on its list; and the neighbours discount that earns.
   */
  async joinOf(pdb: DbClient, shopId: string, businessId: string, placeId: string, now = new Date()): Promise<CommunityJoin> {
    const monthStart = istInstant(`${istDay(now).slice(0, 8)}01`, '00:00');
    const [{ joinDiscountBp }, flats, orders] = await Promise.all([
      awayPricingRepo.get(pdb, businessId),
      pdb.placeUnit.count({ where: { shopId, placeId, archivedAt: null } }),
      pdb.placeOrder.findMany({
        where: {
          shopId,
          member: { placeId, status: 'active' },
          OR: [
            { kind: 'plan', status: 'active' },
            { kind: 'single', status: { in: ['active', 'ended'] }, createdAt: { gte: monthStart } },
          ],
        },
        select: { member: { select: { id: true, unitId: true, unitText: true } } },
      }),
    ]);
    // One home counts once, however many cars or washes it has.
    const homes = new Set(
      orders.map(({ member: m }) => (m.unitId ? `u:${m.unitId}` : m.unitText ? `t:${normalizeUnit(m.unitText)}` : `m:${m.id}`)),
    );
    return communityJoin(homes.size, flats, joinDiscountBp);
  },

  /**
   * What a branch's members can buy: its active vehicle types, the business's active plans priced
   * for the branch, and its services (one-time washes and extras). Platform client.
   */
  async menu(
    pdb: DbClient,
    shopId: string,
    businessId: string | null,
    priceMode: PlacePriceMode,
    /** For one community: the share of its flats that wash with us decides its neighbours discount. */
    placeId?: string,
    /** The plans and services for communities (as joining sees them), or for the shop counter. */
    where: 'community' | 'shop' = 'community',
  ): Promise<PlaceMenu> {
    // Community prices are held to the hub price, so both are read; the shop counter needs only hub.
    const atCommunity = priceMode === 'doorstep';
    const [types, services, plans, shop, join] = await Promise.all([
      pdb.vehicleType.findMany({
        where: { shopId, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, category: true, bodyTypeId: true },
      }),
      pdb.service.findMany({
        where: { shopId, active: true, branchHidden: false },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          modes: true,
          teamAt: true,
          durationMin: true,
          kind: true,
          popular: true,
          showInApp: true,
          checklist: true,
          catalogServiceId: true,
          prices: {
            where: { mode: atCommunity ? { in: ['doorstep', 'hub'] } : priceMode, price: { gt: 0 } },
            select: { vehicleTypeId: true, price: true, mode: true },
          },
          comboItems: { select: { service: { select: { name: true, active: true } } } },
        },
      }),
      businessId
        ? planRepo.list(pdb, businessId, { activeOnly: true }).then((list) =>
            list.filter((p) => (where === 'shop' ? soldAtShop(p.soldAt) : soldAtCommunities(p.soldAt))),
          )
        : Promise.resolve([]),
      pdb.shop.findUnique({ where: { id: shopId }, select: { priceZoneId: true } }),
      atCommunity && businessId && placeId ? planRepo.joinOf(pdb, shopId, businessId, placeId) : Promise.resolve(null),
    ]);
    const off = join?.discountBp ?? 0;
    /** What a community pays for something whose community price is `full` and hub price `hub`. */
    const pay = (full: number, hub: number | null) => (atCommunity ? communityPrice(full, hub, off) : full);
    const typeIds = new Set(types.map((t) => t.id));
    const bodyIds = [...new Set(types.map((t) => t.bodyTypeId).filter((id): id is string => !!id))];
    const [bodies, zone] = await Promise.all([
      bodyIds.length ? pdb.bodyType.findMany({ where: { id: { in: bodyIds } }, select: { id: true, key: true, sizeId: true } }) : Promise.resolve([]),
      shop?.priceZoneId ? pdb.priceZone.findUnique({ where: { id: shop.priceZoneId }, select: { percentBp: true, active: true } }) : Promise.resolve(null),
    ]);
    const zoneBp = zone?.active ? zone.percentBp : 0;
    const [standardPerWash, standardHubPerWash] = businessId
      ? await Promise.all([
          standardPrices(pdb, businessId, plans, priceMode),
          atCommunity ? standardPrices(pdb, businessId, plans, 'hub') : null,
        ])
      : [() => null, null];
    const bodyOf = new Map(bodies.map((b) => [b.id, b]));
    const sizeOfType = new Map(types.map((t) => [t.id, (t.bodyTypeId && bodyOf.get(t.bodyTypeId)?.sizeId) || null]));
    // Only what's done there (Community, or Shop, ticked), priced the way it's paid.
    const offered = services
      .filter((s) => servicePlaces(parseServiceModes(s.modes), parseTeamPlaces(s.teamAt))[where === 'shop' ? 'shop' : 'community'])
      .map((s) => {
        const hubOf = new Map(s.prices.filter((p) => p.mode === 'hub').map((p) => [p.vehicleTypeId, p.price]));
        return {
          ...s,
          prices: s.prices
            .filter((p) => p.mode === priceMode && typeIds.has(p.vehicleTypeId))
            .map((p) => {
              const hub = atCommunity ? (hubOf.get(p.vehicleTypeId) ?? null) : p.price;
              return { vehicleTypeId: p.vehicleTypeId, price: pay(p.price, hub), full: p.price, hub };
            }),
        };
      })
      .filter((s) => s.prices.length > 0);
    const byCatalog = new Map(offered.filter((s) => s.catalogServiceId).map((s) => [s.catalogServiceId!, s]));
    return {
      priceMode,
      join,
      vehicleTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category === 'bike' ? 'bike' : 'car',
        bodyKey: (t.bodyTypeId && bodyOf.get(t.bodyTypeId)?.key) || null,
      })),
      plans: plans.flatMap((p) => {
        const service = byCatalog.get(p.catalogServiceId);
        if (!service) return [];
        const better = p.upgradeServiceId && p.upgradeEvery ? byCatalog.get(p.upgradeServiceId) : null;
        if (p.upgradeServiceId && !better) return [];
        const upgrade = better && p.upgradeEvery ? { every: p.upgradeEvery, name: better.name, catalogServiceId: p.upgradeServiceId! } : null;
        const ups = upgradeWashes(p.washes, upgrade);
        const fixedAt = (mode: PlacePriceMode) => new Map(p.prices.filter((x) => x.mode === mode).map((x) => [x.sizeId, x.price]));
        const fixed = { community: fixedAt(priceMode), hub: fixedAt('hub') };
        /** What this plan's washes cost at head office's Standard book, for a size (null = can't tell). */
        const standardTotal = (size: string | null, lookup: typeof standardPerWash | null) => {
          if (!size || !lookup) return null;
          const per = lookup(p.catalogServiceId, size);
          const up = better ? lookup(p.upgradeServiceId!, size) : null;
          if (per == null || (better && up == null)) return null;
          return per * (p.washes - ups) + (up ?? 0) * ups;
        };
        /**
         * The plan price from per-wash prices: head office's fixed price for the size, following this
         * branch's wash prices (book, own prices, zone) so it saves the same share as at a Standard
         * branch; else the washes less the plan's discount. Always a saving against the same washes
         * one by one (MIN_PLAN_SAVING_BP).
         */
        const planTotal = (listTotal: number, own: number | undefined, standard: number | null) =>
          planPriceWithSaving(
            own != null
              ? standard
                ? scaledPlanPrice(own, listTotal, standard)
                : fixedPlanPrice(own, zoneBp)
              : washPlanPrice(listTotal / p.washes, p.washes, p.discountBp),
            listTotal,
          );
        return [
          {
            id: p.id,
            name: p.name,
            washes: p.washes,
            months: p.months,
            perWeek: p.perWeek,
            discountBp: p.discountBp,
            allowParts: p.allowParts,
            popular: p.popular,
            serviceName: service.name,
            upgrade,
            prices: service.prices.flatMap((pr) => {
              const up = better ? better.prices.find((b) => b.vehicleTypeId === pr.vehicleTypeId) : null;
              if (better && !up) return [];
              const size = sizeOfType.get(pr.vehicleTypeId) ?? null;
              const washes = (per: number, upPer: number) => per * (p.washes - ups) + upPer * ups;
              // The plan at the community price, before the neighbours discount…
              const fullTotal = planTotal(washes(pr.full, up?.full ?? 0), size ? fixed.community.get(size) : undefined, standardTotal(size, standardPerWash));
              // …and the same plan at the hub price, which a community plan never goes below.
              const hubTotal =
                atCommunity && pr.hub != null && (!better || up?.hub != null)
                  ? planTotal(washes(pr.hub, up?.hub ?? 0), size ? fixed.hub.get(size) : undefined, standardTotal(size, standardHubPerWash))
                  : null;
              return [
                {
                  vehicleTypeId: pr.vehicleTypeId,
                  perWash: pr.price,
                  total: pay(fullTotal, hubTotal),
                  // What the same washes cost one by one, at the prices paid here.
                  listTotal: washes(pr.price, up?.price ?? 0),
                  fullTotal,
                },
              ];
            }),
          },
        ];
      }),
      services: offered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        includes: s.comboItems.filter((c) => c.service.active).map((c) => c.service.name),
        durationMin: s.durationMin,
        kind: parseServiceKind(s.kind),
        popular: s.popular,
        /** False = staff sell it; the customer app doesn't offer it. */
        showInApp: s.showInApp,
        checklist: parseChecklist(s.checklist),
        prices: s.prices.map(({ vehicleTypeId, price, full }) => ({ vehicleTypeId, price, full })),
      })),
    };
  },
};
