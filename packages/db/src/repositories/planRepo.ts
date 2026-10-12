import {
  serializeWashPlanRules,
  washesPerWeek,
  washPlanPrice,
  type PlacePriceMode,
  type WashPlanRules,
} from '@mana/domain';
import { createPlatformDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import { businessRules, placeFail } from './placeShared';

/**
 * Wash plans (monthly, quarterly, yearly) are set up once for the business; each wash is one
 * catalog service. A branch's plan price for a vehicle is that service's branch price (doorstep
 * or hub, by the business rule) × washes, less the plan's discount. Plans are switched off, never
 * deleted, because orders point at them.
 */

export interface WashPlanInput {
  name: string;
  washes: number;
  months: number;
  catalogServiceId: string;
  discountBp: number;
  allowParts: boolean;
  popular: boolean;
}

export interface WashPlanView extends WashPlanInput {
  id: string;
  active: boolean;
  sortOrder: number;
  serviceName: string | null;
  perWeek: number;
}

/** Only one active plan is "Most popular": marking one clears the rest in the same batch. */
const clearPopular = (businessId: string, exceptId: string): SqlStatement => ({
  sql: 'UPDATE wash_plans SET popular = 0 WHERE business_id = ? AND id != ? AND popular = 1',
  params: [businessId, exceptId],
});

async function checkService(pdb: DbClient, businessId: string, serviceId: string) {
  const service = await pdb.catalogService.findFirst({ where: { id: serviceId, businessId, active: true }, select: { id: true } });
  if (!service) placeFail('invalid', 'Pick the wash this plan includes.');
}

/** A branch's price list as plans and one-time washes see it. */
export interface PlaceMenu {
  priceMode: PlacePriceMode;
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
    /** Per vehicle type: the one-wash price and the plan price. Types the plan can't serve are absent. */
    prices: { vehicleTypeId: string; perWash: number; total: number }[];
  }[];
  services: {
    id: string;
    name: string;
    description: string | null;
    includes: string[];
    prices: { vehicleTypeId: string; price: number }[];
  }[];
}

export const planRepo = {
  async list(pdb: DbClient, businessId: string, options: { activeOnly?: boolean } = {}): Promise<WashPlanView[]> {
    const plans = await pdb.washPlan.findMany({
      where: { businessId, ...(options.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const services = plans.length
      ? await pdb.catalogService.findMany({
          where: { businessId, id: { in: [...new Set(plans.map((p) => p.catalogServiceId))] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(services.map((s) => [s.id, s.name]));
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      washes: p.washes,
      months: p.months,
      catalogServiceId: p.catalogServiceId,
      serviceName: names.get(p.catalogServiceId) ?? null,
      discountBp: p.discountBp,
      allowParts: p.allowParts,
      popular: p.popular,
      active: p.active,
      sortOrder: p.sortOrder,
      perWeek: washesPerWeek(p.washes, p.months),
    }));
  },

  async create(d1: D1Database, businessId: string, input: WashPlanInput): Promise<string> {
    const pdb = createPlatformDb(d1);
    await checkService(pdb, businessId, input.catalogServiceId);
    const count = await pdb.washPlan.count({ where: { businessId } });
    const id = newId();
    await runStatements(d1, [
      ...(input.popular ? [clearPopular(businessId, id)] : []),
      {
        sql: `INSERT INTO wash_plans (id, business_id, name, washes, months, catalog_service_id, discount_bp, allow_parts, popular, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      },
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
    if (patch.catalogServiceId) await checkService(pdb, businessId, patch.catalogServiceId);
    const active = patch.active ?? plan.active;
    const popular = active && (patch.popular ?? plan.popular);
    await runStatements(d1, [
      ...(popular ? [clearPopular(businessId, id)] : []),
      {
        sql: `UPDATE wash_plans SET name = ?, washes = ?, months = ?, catalog_service_id = ?, discount_bp = ?,
                allow_parts = ?, popular = ?, active = ?, sort_order = ?, updated_at = ${SQL_NOW}
              WHERE business_id = ? AND id = ?`,
        params: [
          patch.name ?? plan.name,
          patch.washes ?? plan.washes,
          patch.months ?? plan.months,
          patch.catalogServiceId ?? plan.catalogServiceId,
          patch.discountBp ?? plan.discountBp,
          patch.allowParts ?? plan.allowParts,
          popular,
          active,
          patch.sortOrder ?? plan.sortOrder,
          businessId,
          id,
        ],
      },
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
   * What a branch's members can buy: its active vehicle types, the business's active plans priced
   * from the branch menu, and its services (one-time washes and extras). Platform client.
   */
  async menu(pdb: DbClient, shopId: string, businessId: string | null, priceMode: PlacePriceMode): Promise<PlaceMenu> {
    const [types, services, plans] = await Promise.all([
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
          catalogServiceId: true,
          prices: { where: { mode: priceMode, price: { gt: 0 } }, select: { vehicleTypeId: true, price: true } },
          comboItems: { select: { service: { select: { name: true, active: true } } } },
        },
      }),
      businessId ? planRepo.list(pdb, businessId, { activeOnly: true }) : Promise.resolve([]),
    ]);
    const typeIds = new Set(types.map((t) => t.id));
    const bodyIds = [...new Set(types.map((t) => t.bodyTypeId).filter((id): id is string => !!id))];
    const bodies = bodyIds.length
      ? await pdb.bodyType.findMany({ where: { id: { in: bodyIds } }, select: { id: true, key: true } })
      : [];
    const bodyKey = new Map(bodies.map((b) => [b.id, b.key]));
    const offered = services
      .filter((s) => s.modes === 'both' || s.modes === priceMode)
      .map((s) => ({ ...s, prices: s.prices.filter((p) => typeIds.has(p.vehicleTypeId)) }))
      .filter((s) => s.prices.length > 0);
    const byCatalog = new Map(offered.filter((s) => s.catalogServiceId).map((s) => [s.catalogServiceId!, s]));
    return {
      priceMode,
      vehicleTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category === 'bike' ? 'bike' : 'car',
        bodyKey: (t.bodyTypeId && bodyKey.get(t.bodyTypeId)) || null,
      })),
      plans: plans.flatMap((p) => {
        const service = byCatalog.get(p.catalogServiceId);
        if (!service) return [];
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
            prices: service.prices.map((pr) => ({
              vehicleTypeId: pr.vehicleTypeId,
              perWash: pr.price,
              total: washPlanPrice(pr.price, p.washes, p.discountBp),
            })),
          },
        ];
      }),
      services: offered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        includes: s.comboItems.filter((c) => c.service.active).map((c) => c.service.name),
        prices: s.prices,
      })),
    };
  },
};
