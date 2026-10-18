import {
  parsePlanSoldAt,
  soldAtCommunities,
  soldAtShop,
  type PlanSoldAt,
  communityTierFor,
  fixedPlanPrice,
  lessDiscount,
  parseChecklist,
  parseServiceKind,
  parseServiceModes,
  parseTeamPlaces,
  servicePlaces,
  serializeWashPlanRules,
  upgradeWashes,
  washesPerWeek,
  washPlanPrice,
  type DeliveryMode,
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
  /** A bigger community's discount, already taken off every price here; null when none applies. */
  volume: { cars: number; discountBp: number } | null;
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
     * by one (to show the saving). Types the plan can't serve are absent.
     */
    prices: { vehicleTypeId: string; perWash: number; total: number; listTotal: number }[];
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
    prices: { vehicleTypeId: string; price: number }[];
  }[];
}

export const planRepo = {
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

  /** The volume discount a community is on, by its cars on the list now. */
  async volumeDiscount(pdb: DbClient, shopId: string, businessId: string, placeId: string) {
    const { communityTiers } = await awayPricingRepo.get(pdb, businessId);
    if (!communityTiers.length) return null;
    const cars = await pdb.memberVehicle.count({
      where: { shopId, status: 'active', member: { placeId, status: 'active' } },
    });
    const tier = communityTierFor(communityTiers, cars);
    return tier ? { cars, discountBp: tier.discountBp } : null;
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
    /** For one community: its cars decide its volume discount. */
    placeId?: string,
    /** The plans and services for communities (as joining sees them), or for the shop counter. */
    where: 'community' | 'shop' = 'community',
  ): Promise<PlaceMenu> {
    const [types, services, plans, shop, volume] = await Promise.all([
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
          prices: { where: { mode: priceMode, price: { gt: 0 } }, select: { vehicleTypeId: true, price: true } },
          comboItems: { select: { service: { select: { name: true, active: true } } } },
        },
      }),
      businessId
        ? planRepo.list(pdb, businessId, { activeOnly: true }).then((list) =>
            list.filter((p) => (where === 'shop' ? soldAtShop(p.soldAt) : soldAtCommunities(p.soldAt))),
          )
        : Promise.resolve([]),
      pdb.shop.findUnique({ where: { id: shopId }, select: { priceZoneId: true } }),
      businessId && placeId ? planRepo.volumeDiscount(pdb, shopId, businessId, placeId) : Promise.resolve(null),
    ]);
    const less = (paise: number) => (volume ? lessDiscount(paise, volume.discountBp) : paise);
    const typeIds = new Set(types.map((t) => t.id));
    const bodyIds = [...new Set(types.map((t) => t.bodyTypeId).filter((id): id is string => !!id))];
    const [bodies, zone] = await Promise.all([
      bodyIds.length ? pdb.bodyType.findMany({ where: { id: { in: bodyIds } }, select: { id: true, key: true, sizeId: true } }) : Promise.resolve([]),
      shop?.priceZoneId ? pdb.priceZone.findUnique({ where: { id: shop.priceZoneId }, select: { percentBp: true, active: true } }) : Promise.resolve(null),
    ]);
    const zoneBp = zone?.active ? zone.percentBp : 0;
    const bodyOf = new Map(bodies.map((b) => [b.id, b]));
    const sizeOfType = new Map(types.map((t) => [t.id, (t.bodyTypeId && bodyOf.get(t.bodyTypeId)?.sizeId) || null]));
    // Only what's done there (Community, or Shop, ticked), priced the way it's paid.
    const offered = services
      .filter((s) => servicePlaces(parseServiceModes(s.modes), parseTeamPlaces(s.teamAt))[where === 'shop' ? 'shop' : 'community'])
      .map((s) => ({
        ...s,
        prices: s.prices.filter((p) => typeIds.has(p.vehicleTypeId)).map((p) => ({ ...p, price: less(p.price) })),
      }))
      .filter((s) => s.prices.length > 0);
    const byCatalog = new Map(offered.filter((s) => s.catalogServiceId).map((s) => [s.catalogServiceId!, s]));
    return {
      priceMode,
      volume,
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
        const fixed = new Map(p.prices.filter((x) => x.mode === priceMode).map((x) => [x.sizeId, x.price]));
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
              const upPrice = better ? better.prices.find((b) => b.vehicleTypeId === pr.vehicleTypeId)?.price : null;
              if (better && upPrice == null) return [];
              const listTotal = pr.price * (p.washes - ups) + (upPrice ?? 0) * ups;
              const size = sizeOfType.get(pr.vehicleTypeId);
              const own = size ? fixed.get(size) : undefined;
              return [
                {
                  vehicleTypeId: pr.vehicleTypeId,
                  perWash: pr.price,
                  total: own != null ? less(fixedPlanPrice(own, zoneBp)) : washPlanPrice(listTotal / p.washes, p.washes, p.discountBp),
                  listTotal,
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
        prices: s.prices,
      })),
    };
  },
};
