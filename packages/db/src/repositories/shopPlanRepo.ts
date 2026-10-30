import {
  buildPlan,
  builtPlanTitle,
  istDay,
  PLAN_GRACE_DAYS,
  PLAN_WASHES_A_MONTH,
  planLastDay,
  planUseBy,
  secondCarPlanPrice,
  shopPlanProblem,
  shortWashName,
  upgradeWashes,
  type PaymentMethod,
  type PlanLength,
  type PlanWashKind,
} from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';
import { newId } from '../ids';
import { runStatements, SQL_NOW } from '../sql';
import { customPlanId, planRepo } from './planRepo';

/** The hidden line a plan sale goes on: one per branch, never on the menu. */
const planServiceId = (shopId: string) => `wash-plan-${shopId}`;

/** A plan the counter can sell for one vehicle type, with what it costs here. */
export interface ShopPlanForSale {
  planId: string;
  name: string;
  washes: number;
  months: number;
  serviceName: string;
  upgrade: { every: number; name: string } | null;
  popular: boolean;
  /** What the customer pays for the plan, and the washes one by one. */
  total: number;
  listTotal: number;
  /** A second car in the same home: `total` is 10% off; this is the plan's usual price. */
  secondCar: { fullTotal: number } | null;
}

/** A wash the counter can put in a plan the customer builds, with its price for the vehicle. */
export interface BuildableWash {
  serviceId: string;
  catalogServiceId: string;
  name: string;
  price: number;
}

/** One wash of a plan's pack, and how many of it are left. */
export interface ShopPlanOption {
  /** Its catalog wash: what New Wash sends back to use one. */
  key: string;
  /** The pack's first wash is "base", the rest "upgrade" (for apps that only know the two). */
  kind: PlanWashKind;
  /** The wash's name ("Express Wash"), and the branch service it is (null: not on this menu). */
  name: string;
  service: { id: string; name: string } | null;
  left: number;
}

/** A vehicle's running shop plan, as New Wash sees it. */
export interface VehicleShopPlan {
  orderId: string;
  title: string;
  washesUsed: number;
  washesTotal: number;
  endsOn: string;
  /** Its last day plus the grace week: the last day it can still pay for a wash. */
  useBy: string;
  /** Washes carried over from the plan before it. */
  carriedIn: number;
  /** The vehicle it's for. */
  vehicle: { typeId: string; typeName: string; registrationNumber: string };
  /** Its washes (Express, and Premium; or any a built plan holds): any order, one a day. */
  options: ShopPlanOption[];
  /** The wash it pays for when New Wash doesn't say (the first one with any left). */
  service: { id: string; name: string } | null;
  /** Why it can't pay for a wash today; null when it can. */
  problem: string | null;
}

/** One wash of an order's pack. */
export interface PackWash {
  catalogServiceId: string;
  washesTotal: number;
  washesUsed: number;
  sortOrder: number;
}

type PackOrder = {
  id: string;
  catalogServiceId: string;
  upgradeServiceId: string | null;
  washesTotal: number;
  washesUsed: number;
  upgradesTotal: number;
  upgradesUsed: number;
};

/** A plan sold before packs were kept wash by wash: its everyday wash, then its better one. */
function legacyPack(o: PackOrder): PackWash[] {
  const better = o.upgradeServiceId && o.upgradesTotal > 0 && o.upgradeServiceId !== o.catalogServiceId;
  const baseTotal = better ? o.washesTotal - o.upgradesTotal : o.washesTotal;
  const baseUsed = better ? o.washesUsed - o.upgradesUsed : o.washesUsed;
  return [
    { catalogServiceId: o.catalogServiceId, washesTotal: baseTotal, washesUsed: Math.min(Math.max(0, baseUsed), baseTotal), sortOrder: 0 },
    ...(better ? [{ catalogServiceId: o.upgradeServiceId!, washesTotal: o.upgradesTotal, washesUsed: Math.min(o.upgradesUsed, o.upgradesTotal), sortOrder: 1 }] : []),
  ];
}

const packRowSql = `INSERT OR IGNORE INTO shop_plan_order_washes (shop_id, order_id, catalog_service_id, washes_total, washes_used, sort_order) VALUES (?, ?, ?, ?, ?, ?)`;

export type ShopPlanResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Wash plans sold at the counter: paid in full when sold (a paid bill, so the cash drawer and
 * Reports count it), for one vehicle, used at the branch that sold it. A plan is a pack: so many
 * everyday washes and so many better ones, used in any order, one a day, until a week after its
 * last day. When it runs out with washes left and the customer has renewed, one of them carries
 * over to the new plan.
 */
export const shopPlanRepo = {
  /** Every plan sold at this branch's counter, priced for each vehicle type (for the branch menu). */
  async menu(d1: D1Database, shopId: string) {
    const pdb = createPlatformDb(d1);
    const shop = await pdb.shop.findUnique({ where: { id: shopId }, select: { businessId: true } });
    if (!shop?.businessId) return [];
    return (await planRepo.menu(pdb, shopId, shop.businessId, 'hub', undefined, 'shop')).plans;
  },

  /**
   * `secondCar`: the customer already has a plan running on another vehicle, so these are priced
   * for a second car in the same home (10% off).
   */
  async forSale(d1: D1Database, shopId: string, vehicleTypeId: string, secondCar = false): Promise<ShopPlanForSale[]> {
    const pdb = createPlatformDb(d1);
    const shop = await pdb.shop.findUnique({ where: { id: shopId }, select: { businessId: true } });
    if (!shop?.businessId) return [];
    const menu = await planRepo.menu(pdb, shopId, shop.businessId, 'hub', undefined, 'shop');
    return menu.plans.flatMap((p) => {
      const price = p.prices.find((x) => x.vehicleTypeId === vehicleTypeId);
      if (!price) return [];
      return [
        {
          planId: p.id,
          name: p.name,
          washes: p.washes,
          months: p.months,
          serviceName: p.serviceName,
          upgrade: p.upgrade ? { every: p.upgrade.every, name: p.upgrade.name } : null,
          popular: p.popular,
          total: secondCar ? secondCarPlanPrice(price.total) : price.total,
          listTotal: price.listTotal,
          secondCar: secondCar ? { fullTotal: price.total } : null,
        },
      ];
    });
  },

  /**
   * The washes a customer can build a plan from for a vehicle type: the branch's washes with a hub
   * price for it, cheapest first. None where the branch sells no plans for the type.
   */
  async buildable(d1: D1Database, shopId: string, vehicleTypeId: string): Promise<BuildableWash[]> {
    if (!(await shopPlanRepo.forSale(d1, shopId, vehicleTypeId)).length) return [];
    const db = createShopDb(d1, shopId);
    const services = await db.service.findMany({
      where: { active: true, branchHidden: false, kind: 'wash', catalogServiceId: { not: null } },
      select: { id: true, name: true, catalogServiceId: true },
    });
    const prices = await db.servicePrice.findMany({ where: { vehicleTypeId, mode: 'hub', serviceId: { in: services.map((s) => s.id) } } });
    return services
      .flatMap((s) => {
        const price = prices.find((p) => p.serviceId === s.id)?.price;
        return price ? [{ serviceId: s.id, catalogServiceId: s.catalogServiceId!, name: s.name, price }] : [];
      })
      .sort((a, b) => a.price - b.price);
  },

  /** An order's pack, wash by wash (kept per wash; worked out for a plan sold before that). */
  async pack(d1: D1Database, shopId: string, order: PackOrder): Promise<PackWash[]> {
    const rows = await createShopDb(d1, shopId).shopPlanOrderWash.findMany({ where: { orderId: order.id }, orderBy: { sortOrder: 'asc' } });
    return rows.length ? rows : legacyPack(order);
  },

  /** Whether a customer (by phone) buying a plan for this vehicle would be the second car at home. */
  async isSecondCar(d1: D1Database, shopId: string, phone: string, registrationNumber?: string | null): Promise<boolean> {
    const db = createShopDb(d1, shopId);
    const customer = await db.customer.findFirst({ where: { phone }, select: { id: true } });
    if (!customer) return false;
    const vehicle = registrationNumber
      ? await db.vehicle.findFirst({ where: { registrationNumber, customerId: customer.id }, select: { id: true } })
      : null;
    return planRepo.customerHasPlan(db, customer.id, vehicle?.id ?? null);
  },

  /**
   * One unused wash of a plan whose time is up carries over to the plan the customer renewed
   * with (the newest plan on the vehicle still running). Each plan carries once; safe to repeat.
   */
  async settleCarryOver(d1: D1Database, shopId: string, vehicleId: string, today: string) {
    const db = createShopDb(d1, shopId);
    const orders = await db.shopPlanOrder.findMany({ where: { vehicleId, status: 'active' }, orderBy: { createdAt: 'asc' } });
    for (const old of orders) {
      if (old.carriedTo || today <= planUseBy(old.endsOn) || old.washesUsed >= old.washesTotal) continue;
      const renewal = orders.filter((o) => o.id !== old.id && o.createdAt > old.createdAt && today <= planUseBy(o.endsOn)).at(-1);
      if (!renewal) continue;
      const carried = `(SELECT COUNT(*) FROM shop_plan_orders WHERE shop_id = ? AND carried_to = ?)`;
      await runStatements(d1, [
        {
          sql: `UPDATE shop_plan_orders SET carried_to = ?, status = 'ended', ended_at = ${SQL_NOW}
                WHERE shop_id = ? AND id = ? AND status = 'active' AND carried_to IS NULL`,
          params: [renewal.id, shopId, old.id],
        },
        {
          // The carried wash is one more of the new plan's first wash. Read before carried_in moves.
          sql: `UPDATE shop_plan_order_washes SET washes_total = washes_total + (${carried} - (SELECT carried_in FROM shop_plan_orders WHERE shop_id = ? AND id = ?))
                WHERE shop_id = ? AND order_id = ? AND sort_order = (SELECT MIN(sort_order) FROM shop_plan_order_washes WHERE shop_id = ? AND order_id = ?)`,
          params: [shopId, renewal.id, shopId, renewal.id, shopId, renewal.id, shopId, renewal.id],
        },
        {
          // Both sides read the row as it was, so a repeat adds nothing.
          sql: `UPDATE shop_plan_orders SET washes_total = washes_total + (${carried} - carried_in), carried_in = ${carried}
                WHERE shop_id = ? AND id = ?`,
          params: [shopId, renewal.id, shopId, renewal.id, shopId, renewal.id],
        },
      ]);
    }
  },

  /** A vehicle's running shop plans at this branch, what's left of each, and whether it can pay today. */
  async forVehicle(d1: D1Database, shopId: string, registrationNumber: string, now: Date): Promise<VehicleShopPlan[]> {
    const db = createShopDb(d1, shopId);
    const vehicle = await db.vehicle.findFirst({ where: { registrationNumber }, select: { id: true, vehicleTypeId: true } });
    if (!vehicle) return [];
    const today = istDay(now);
    await shopPlanRepo.settleCarryOver(d1, shopId, vehicle.id, today);
    const type = await db.vehicleType.findUnique({ where: { id: vehicle.vehicleTypeId }, select: { name: true } });
    const orders = await db.shopPlanOrder.findMany({
      where: { vehicleId: vehicle.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (!orders.length) return [];
    const packs = new Map(await Promise.all(orders.map(async (o) => [o.id, await shopPlanRepo.pack(d1, shopId, o)] as const)));
    const catalogIds = [...new Set([...packs.values()].flat().map((w) => w.catalogServiceId))];
    const [uses, services, catalog] = await Promise.all([
      db.shopPlanUse.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, day: today }, select: { orderId: true } }),
      db.service.findMany({ where: { catalogServiceId: { in: catalogIds }, active: true }, select: { id: true, name: true, catalogServiceId: true } }),
      createPlatformDb(d1).catalogService.findMany({ where: { id: { in: catalogIds } }, select: { id: true, name: true } }),
    ]);
    const branchService = (catalogId: string | null) => {
      const s = catalogId ? services.find((x) => x.catalogServiceId === catalogId) : null;
      return s ? { id: s.id, name: s.name } : null;
    };
    const nameOf = (catalogId: string) => catalog.find((c) => c.id === catalogId)?.name ?? branchService(catalogId)?.name ?? 'Wash';
    return orders.map((o) => {
      const options: ShopPlanOption[] = packs
        .get(o.id)!
        .filter((w) => w.washesTotal > 0)
        .map((w, i) => ({
          key: w.catalogServiceId,
          kind: i === 0 ? 'base' : 'upgrade',
          name: nameOf(w.catalogServiceId),
          service: branchService(w.catalogServiceId),
          left: Math.max(0, w.washesTotal - w.washesUsed),
        }));
      const usable = options.filter((x) => x.left > 0 && x.service);
      const problem =
        shopPlanProblem(o, today, uses.some((u) => u.orderId === o.id)) ??
        (usable.length ? null : 'This branch’s menu doesn’t have the washes this plan covers.');
      return {
        orderId: o.id,
        title: o.title,
        washesUsed: o.washesUsed,
        washesTotal: o.washesTotal,
        endsOn: o.endsOn,
        useBy: planUseBy(o.endsOn),
        carriedIn: o.carriedIn,
        vehicle: { typeId: vehicle.vehicleTypeId, typeName: type?.name ?? 'Vehicle', registrationNumber },
        options,
        service: usable[0]?.service ?? null,
        problem,
      };
    });
  },

  /**
   * Sells a plan for a vehicle: the plan, and its paid bill. `saleId` is the client's id for the
   * sale (and its bill), so a retried request sells it once. Either one of the branch's plans
   * (`planId`), or one the customer built (`custom`: 4 of the branch's washes and a length).
   */
  async sell(
    d1: D1Database,
    shopId: string,
    input: {
      saleId: string;
      planId?: string;
      custom?: { serviceIds: string[]; length: PlanLength };
      customerId: string;
      vehicleId: string;
      vehicleTypeId: string;
      paymentMethod: PaymentMethod;
      byUserId: string;
      now: Date;
    },
  ): Promise<ShopPlanResult<{ orderId: string; jobId: string; total: number; fullTotal: number; endsOn: string }>> {
    const db = createShopDb(d1, shopId);
    const already = await db.shopPlanOrder.findFirst({ where: { saleJobId: input.saleId } });
    if (already) {
      return { ok: true, value: { orderId: already.id, jobId: already.saleJobId, total: already.price, fullTotal: already.price, endsOn: already.endsOn } };
    }

    // A second car in the same home: another plan of theirs is running on a different vehicle.
    const secondCar = await planRepo.customerHasPlan(db, input.customerId, input.vehicleId);
    const notSold = { ok: false as const, message: 'This plan isn’t sold here for this vehicle.' };
    let sale: {
      planId: string;
      title: string;
      months: number;
      catalogServiceId: string;
      upgradeServiceId: string | null;
      upgradeEvery: number | null;
      upgradesTotal: number;
      washes: { catalogServiceId: string; count: number }[];
      total: number;
      fullTotal: number;
    };
    const ensureCustomPlan: { sql: string; params: unknown[] }[] = [];
    if (input.custom) {
      const { serviceIds, length } = input.custom;
      if (serviceIds.length !== PLAN_WASHES_A_MONTH) return { ok: false, message: `Pick ${PLAN_WASHES_A_MONTH} washes for the plan.` };
      const washes = await shopPlanRepo.buildable(d1, shopId, input.vehicleTypeId);
      const picks = serviceIds.map((id) => washes.find((w) => w.serviceId === id));
      if (!washes.length || picks.some((p) => !p)) return notSold;
      const built = buildPlan(
        picks.map((p) => ({ id: p!.catalogServiceId, price: p!.price })),
        length,
      );
      // Cheapest first: the plan's first wash takes a carried-over wash.
      const ordered = washes.filter((w) => built.washes.some((x) => x.id === w.catalogServiceId));
      const month = ordered.map((w) => ({ name: w.name, count: picks.filter((p) => p!.catalogServiceId === w.catalogServiceId).length }));
      const business = (await createPlatformDb(d1).shop.findUnique({ where: { id: shopId }, select: { businessId: true } }))?.businessId;
      if (!business) return notSold;
      const planId = customPlanId(business);
      // Every built plan hangs off one hidden plan per business: never on a menu, never listed.
      ensureCustomPlan.push({
        sql: `INSERT OR IGNORE INTO wash_plans (id, business_id, name, washes, months, catalog_service_id, active, sold_at, sort_order)
              VALUES (?, ?, 'Custom plan', ?, 1, ?, 0, 'shop', 10000)`,
        params: [planId, business, PLAN_WASHES_A_MONTH, ordered[0]!.catalogServiceId],
      });
      sale = {
        planId,
        title: builtPlanTitle(month, length),
        months: built.months,
        catalogServiceId: ordered[0]!.catalogServiceId,
        upgradeServiceId: null,
        upgradeEvery: null,
        upgradesTotal: 0,
        washes: ordered.map((w) => ({ catalogServiceId: w.catalogServiceId, count: built.washes.find((x) => x.id === w.catalogServiceId)!.count })),
        total: secondCar ? secondCarPlanPrice(built.price) : built.price,
        fullTotal: built.price,
      };
    } else {
      const offer = (await shopPlanRepo.forSale(d1, shopId, input.vehicleTypeId, secondCar)).find((p) => p.planId === input.planId);
      if (!offer || !input.planId) return notSold;
      const plan = await createPlatformDb(d1).washPlan.findUnique({
        where: { id: input.planId },
        select: { catalogServiceId: true, upgradeServiceId: true, upgradeEvery: true },
      });
      if (!plan) return notSold;
      // The pack's better washes: one in every N (Express Shine: 1 of 4; 3 of 13).
      const better =
        plan.upgradeServiceId && plan.upgradeEvery && plan.upgradeServiceId !== plan.catalogServiceId ? upgradeWashes(offer.washes, { every: plan.upgradeEvery }) : 0;
      sale = {
        planId: input.planId,
        title: offer.name,
        months: offer.months,
        catalogServiceId: plan.catalogServiceId,
        upgradeServiceId: plan.upgradeServiceId,
        upgradeEvery: plan.upgradeEvery,
        upgradesTotal: better,
        washes: [
          { catalogServiceId: plan.catalogServiceId, count: offer.washes - better },
          ...(better ? [{ catalogServiceId: plan.upgradeServiceId!, count: better }] : []),
        ],
        total: offer.total,
        fullTotal: offer.secondCar?.fullTotal ?? offer.total,
      };
    }

    const today = istDay(input.now);
    const endsOn = planLastDay(today, sale.months);
    const orderId = newId();
    const lineId = planServiceId(shopId);
    await db.service.upsert({
      where: { id: lineId },
      create: {
        id: lineId,
        name: 'Wash plan',
        description: 'A wash plan sold at the counter.',
        active: false,
        appliesTo: 'both',
        modes: 'hub',
        kind: 'addon',
        showInApp: false,
        sortOrder: 10_001,
      },
      update: {},
    });
    const washesTotal = sale.washes.reduce((n, w) => n + w.count, 0);
    try {
      await runStatements(d1, [
        ...ensureCustomPlan,
        {
          sql: `INSERT INTO shop_plan_orders (id, shop_id, plan_id, customer_id, vehicle_id, title, catalog_service_id,
                  upgrade_service_id, upgrade_every, washes_total, upgrades_total, price, payment_method, sale_job_id, starts_on, ends_on, sold_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            orderId,
            shopId,
            sale.planId,
            input.customerId,
            input.vehicleId,
            sale.title,
            sale.catalogServiceId,
            sale.upgradeServiceId,
            sale.upgradeEvery,
            washesTotal,
            sale.upgradesTotal,
            sale.total,
            input.paymentMethod,
            input.saleId,
            today,
            endsOn,
            input.byUserId,
          ],
        },
        ...sale.washes.map((w, i) => ({ sql: packRowSql, params: [shopId, orderId, w.catalogServiceId, w.count, 0, i] })),
      ]);
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
      const winner = await db.shopPlanOrder.findFirst({ where: { saleJobId: input.saleId } });
      if (winner) {
        return { ok: true, value: { orderId: winner.id, jobId: winner.saleJobId, total: winner.price, fullTotal: winner.price, endsOn: winner.endsOn } };
      }
      throw e;
    }
    return { ok: true, value: { orderId, jobId: input.saleId, total: sale.total, fullTotal: sale.fullTotal, endsOn } };
  },

  /** The service the sale's bill line goes on. */
  saleServiceId: planServiceId,

  /**
   * Uses one wash of a shop plan's pack for a wash: `wash` is the catalog wash (an older app sends
   * `kind`: the plan's everyday or better wash). Checked again here (this vehicle, not ended, one
   * of that wash left, not already used today), and recorded with the wash so voiding gives it back.
   */
  async use(
    d1: D1Database,
    shopId: string,
    input: { orderId: string; jobId: string; registrationNumber: string; wash?: string; kind?: PlanWashKind; now: Date },
  ): Promise<ShopPlanResult<null>> {
    const db = createShopDb(d1, shopId);
    const mine = await db.shopPlanUse.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    if (mine) return { ok: true, value: null };
    const order = await db.shopPlanOrder.findUnique({ where: { id: input.orderId } });
    const vehicle = await db.vehicle.findFirst({ where: { registrationNumber: input.registrationNumber }, select: { id: true } });
    if (!order || !vehicle || order.vehicleId !== vehicle.id) return { ok: false, message: 'This plan is for another vehicle.' };
    const today = istDay(input.now);
    const usedToday = (await db.shopPlanUse.count({ where: { orderId: order.id, day: today } })) > 0;
    const problem = shopPlanProblem(order, today, usedToday);
    if (problem) return { ok: false, message: problem };

    const pack = (await shopPlanRepo.pack(d1, shopId, order)).filter((w) => w.washesTotal > 0);
    const catalog = await createPlatformDb(d1).catalogService.findMany({ where: { id: { in: pack.map((w) => w.catalogServiceId) } }, select: { id: true, name: true } });
    const nameOf = (id: string) => shortWashName(catalog.find((c) => c.id === id)?.name ?? 'wash');
    const wanted = input.wash ?? (input.kind === 'upgrade' ? pack[1]?.catalogServiceId : pack[0]?.catalogServiceId);
    const row = pack.find((w) => w.catalogServiceId === wanted);
    if (!row) return { ok: false, message: input.kind === 'upgrade' && !input.wash ? 'This plan has no better wash.' : 'This plan doesn’t cover that wash.' };
    if (row.washesUsed >= row.washesTotal) {
      const others = pack.filter((w) => w.washesUsed < w.washesTotal).map((w) => nameOf(w.catalogServiceId));
      return { ok: false, message: `No ${nameOf(row.catalogServiceId)} left on this plan${others.length ? `: use its ${others.join(' or ')}` : ''}.` };
    }
    const better = row.catalogServiceId === order.upgradeServiceId && row.sortOrder > 0;
    try {
      await runStatements(d1, [
        // A plan sold before packs were kept per wash gets its rows first.
        ...pack.map((w) => ({ sql: packRowSql, params: [shopId, order.id, w.catalogServiceId, w.washesTotal, w.washesUsed, w.sortOrder] })),
        {
          // One of that wash still left, checked in the same write.
          sql: `INSERT INTO shop_plan_uses (id, shop_id, order_id, job_id, day, kind, catalog_service_id)
                SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
                  SELECT 1 FROM shop_plan_orders WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total
                    AND date(ends_on, '+' || ? || ' days') >= ?)
                AND EXISTS (
                  SELECT 1 FROM shop_plan_order_washes WHERE shop_id = ? AND order_id = ? AND catalog_service_id = ? AND washes_used < washes_total)`,
          params: [
            newId(),
            shopId,
            order.id,
            input.jobId,
            today,
            better ? 'upgrade' : 'base',
            row.catalogServiceId,
            shopId,
            order.id,
            PLAN_GRACE_DAYS,
            today,
            shopId,
            order.id,
            row.catalogServiceId,
          ],
        },
        {
          sql: `UPDATE shop_plan_order_washes SET washes_used = washes_used + 1
                WHERE shop_id = ? AND order_id = ? AND catalog_service_id = ? AND washes_used < washes_total
                  AND EXISTS (SELECT 1 FROM shop_plan_uses WHERE shop_id = ? AND job_id = ?)`,
          params: [shopId, order.id, row.catalogServiceId, shopId, input.jobId],
        },
        {
          sql: `UPDATE shop_plan_orders SET washes_used = washes_used + 1, upgrades_used = MIN(upgrades_total, upgrades_used + ?),
                  status = CASE WHEN washes_used + 1 >= washes_total THEN 'ended' ELSE status END,
                  ended_at = CASE WHEN washes_used + 1 >= washes_total THEN ${SQL_NOW} ELSE ended_at END
                WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total
                  AND EXISTS (SELECT 1 FROM shop_plan_uses WHERE shop_id = ? AND job_id = ?)`,
          params: [better ? 1 : 0, shopId, order.id, shopId, input.jobId],
        },
      ]);
    } catch (e) {
      if (isUniqueClash(e)) return { ok: false, message: 'This plan was already used today: one wash a day.' };
      throw e;
    }
    const used = await db.shopPlanUse.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    return used ? { ok: true, value: null } : { ok: false, message: `No ${nameOf(row.catalogServiceId)} left on this plan.` };
  },

  /** Gives back the plan wash a voided wash used. Safe to repeat. */
  async release(d1: D1Database, shopId: string, jobId: string) {
    const db = createShopDb(d1, shopId);
    const use = await db.shopPlanUse.findFirst({ where: { jobId }, select: { id: true, orderId: true, kind: true, catalogServiceId: true } });
    if (!use) return;
    const better = use.kind === 'upgrade' ? 1 : 0;
    // A use from before packs were kept per wash: its wash was the plan's everyday or better one.
    const order = use.catalogServiceId ? null : await db.shopPlanOrder.findUnique({ where: { id: use.orderId }, select: { catalogServiceId: true, upgradeServiceId: true } });
    const wash = use.catalogServiceId ?? (better && order?.upgradeServiceId ? order.upgradeServiceId : order?.catalogServiceId) ?? '';
    const useExists = 'EXISTS (SELECT 1 FROM shop_plan_uses WHERE shop_id = ? AND id = ?)';
    await runStatements(d1, [
      {
        sql: `UPDATE shop_plan_order_washes SET washes_used = washes_used - 1
              WHERE shop_id = ? AND order_id = ? AND catalog_service_id = ? AND washes_used > 0 AND ${useExists}`,
        params: [shopId, use.orderId, wash, shopId, use.id],
      },
      {
        sql: `UPDATE shop_plan_orders SET washes_used = washes_used - 1, upgrades_used = MAX(0, upgrades_used - ${better}),
                status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
                ended_at = CASE WHEN status = 'ended' THEN NULL ELSE ended_at END
              WHERE shop_id = ? AND id = ? AND washes_used > 0 AND status IN ('active', 'ended') AND ${useExists}`,
        params: [shopId, use.orderId, shopId, use.id],
      },
      { sql: 'DELETE FROM shop_plan_uses WHERE shop_id = ? AND id = ?', params: [shopId, use.id] },
    ]);
  },

  /** Why a plan's sale bill can't be voided (a wash on it is used), or null. */
  async saleInUse(db: DbClient, saleJobId: string): Promise<string | null> {
    const order = await db.shopPlanOrder.findFirst({ where: { saleJobId }, select: { washesUsed: true } });
    if (!order || order.washesUsed === 0) return null;
    return `${order.washesUsed} wash${order.washesUsed === 1 ? ' is' : 'es are'} used on this plan, so its sale can’t be voided.`;
  },

  /** The plan a voided sale bill sold is cancelled (only while none of its washes is used). Safe to repeat. */
  async cancelSale(db: DbClient, saleJobId: string) {
    await db.shopPlanOrder.updateMany({ where: { saleJobId, washesUsed: 0, status: 'active' }, data: { status: 'void' } });
  },
};
