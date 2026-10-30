import { istDay, packWashProblem, PLAN_GRACE_DAYS, planLastDay, planPack, planUseBy, secondCarPlanPrice, shopPlanProblem, upgradeWashes, type PaymentMethod, type PlanWashKind } from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';
import { newId } from '../ids';
import { runStatements, SQL_NOW } from '../sql';
import { planRepo } from './planRepo';

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

/** One kind of a plan's washes: its everyday wash or its better one, and how many are left. */
export interface ShopPlanOption {
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
  /** Its everyday wash, and its better one when it has one: any order, one a day. */
  options: ShopPlanOption[];
  /** The wash it pays for when New Wash doesn't say (the everyday one while any is left). */
  service: { id: string; name: string } | null;
  /** Why it can't pay for a wash today; null when it can. */
  problem: string | null;
}

const usesKind = (k: string | null | undefined): PlanWashKind => (k === 'upgrade' ? 'upgrade' : 'base');

export type ShopPlanResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Wash plans sold at the counter: paid in full when sold (a paid bill, so the cash drawer and
 * Reports count it), for one vehicle, used at the branch that sold it. A plan is a pack: so many
 * everyday washes and so many better ones, used in any order, one a day, until a week after its
 * last day. When it runs out with washes left and the customer has renewed, one of them carries
 * over to the new plan.
 */
export const shopPlanRepo = {
  /** The plans this branch sells at the counter for a vehicle type, priced at the hub. */
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
      if (old.carriedTo || today <= planUseBy(old.endsOn) || planPack(old).left === 0) continue;
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
    const catalogIds = [...new Set(orders.flatMap((o) => [o.catalogServiceId, o.upgradeServiceId]).filter((x): x is string => !!x))];
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
      const pack = planPack(o);
      const options: ShopPlanOption[] = [
        { kind: 'base', name: nameOf(o.catalogServiceId), service: branchService(o.catalogServiceId), left: pack.everydayLeft },
        ...(o.upgradeServiceId && o.upgradesTotal > 0
          ? [{ kind: 'upgrade' as const, name: nameOf(o.upgradeServiceId), service: branchService(o.upgradeServiceId), left: pack.betterLeft }]
          : []),
      ];
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
   * sale (and its bill), so a retried request sells it once.
   */
  async sell(
    d1: D1Database,
    shopId: string,
    input: {
      saleId: string;
      planId: string;
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
    const offer = (await shopPlanRepo.forSale(d1, shopId, input.vehicleTypeId, secondCar)).find((p) => p.planId === input.planId);
    if (!offer) return { ok: false, message: 'This plan isn’t sold here for this vehicle.' };
    const plan = await createPlatformDb(d1).washPlan.findUnique({
      where: { id: input.planId },
      select: { catalogServiceId: true, upgradeServiceId: true, upgradeEvery: true },
    });
    if (!plan) return { ok: false, message: 'This plan isn’t sold here for this vehicle.' };

    const today = istDay(input.now);
    const endsOn = planLastDay(today, offer.months);
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
    try {
      await runStatements(d1, [
        {
          sql: `INSERT INTO shop_plan_orders (id, shop_id, plan_id, customer_id, vehicle_id, title, catalog_service_id,
                  upgrade_service_id, upgrade_every, washes_total, upgrades_total, price, payment_method, sale_job_id, starts_on, ends_on, sold_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            orderId,
            shopId,
            input.planId,
            input.customerId,
            input.vehicleId,
            offer.name,
            plan.catalogServiceId,
            plan.upgradeServiceId,
            plan.upgradeEvery,
            offer.washes,
            // The pack's better washes: one in every N (Express + Premium: 1 of 4; 3 of 13).
            plan.upgradeServiceId && plan.upgradeEvery ? upgradeWashes(offer.washes, { every: plan.upgradeEvery }) : 0,
            offer.total,
            input.paymentMethod,
            input.saleId,
            today,
            endsOn,
            input.byUserId,
          ],
        },
      ]);
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
      const winner = await db.shopPlanOrder.findFirst({ where: { saleJobId: input.saleId } });
      if (winner) {
        return { ok: true, value: { orderId: winner.id, jobId: winner.saleJobId, total: winner.price, fullTotal: winner.price, endsOn: winner.endsOn } };
      }
      throw e;
    }
    return { ok: true, value: { orderId, jobId: input.saleId, total: offer.total, fullTotal: offer.secondCar?.fullTotal ?? offer.total, endsOn } };
  },

  /** The service the sale's bill line goes on. */
  saleServiceId: planServiceId,

  /**
   * Uses one wash of a shop plan's pack for a wash, an everyday one or a better one: checked again
   * here (this vehicle, not ended, one of that kind left, not already used today), and recorded
   * with the wash so voiding it gives it back.
   */
  async use(
    d1: D1Database,
    shopId: string,
    input: { orderId: string; jobId: string; registrationNumber: string; kind: PlanWashKind; now: Date },
  ): Promise<ShopPlanResult<null>> {
    const db = createShopDb(d1, shopId);
    const mine = await db.shopPlanUse.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    if (mine) return { ok: true, value: null };
    const order = await db.shopPlanOrder.findUnique({ where: { id: input.orderId } });
    const vehicle = await db.vehicle.findFirst({ where: { registrationNumber: input.registrationNumber }, select: { id: true } });
    if (!order || !vehicle || order.vehicleId !== vehicle.id) return { ok: false, message: 'This plan is for another vehicle.' };
    const today = istDay(input.now);
    const usedToday = (await db.shopPlanUse.count({ where: { orderId: order.id, day: today } })) > 0;
    const problem =
      shopPlanProblem(order, today, usedToday) ??
      packWashProblem(planPack(order), input.kind, { base: 'everyday wash', upgrade: order.upgradeServiceId ? 'better wash' : null });
    if (problem) return { ok: false, message: problem };
    const better = input.kind === 'upgrade';
    // One of that kind still left, checked in the same write.
    const kindLeft = better ? 'upgrades_used < upgrades_total' : '(washes_used - upgrades_used) < (washes_total - upgrades_total)';
    try {
      await runStatements(d1, [
        {
          sql: `INSERT INTO shop_plan_uses (id, shop_id, order_id, job_id, day, kind)
                SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
                  SELECT 1 FROM shop_plan_orders WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total
                    AND ${kindLeft} AND date(ends_on, '+' || ? || ' days') >= ?)`,
          params: [newId(), shopId, order.id, input.jobId, today, input.kind, shopId, order.id, PLAN_GRACE_DAYS, today],
        },
        {
          sql: `UPDATE shop_plan_orders SET washes_used = washes_used + 1, upgrades_used = upgrades_used + ?,
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
    return used ? { ok: true, value: null } : { ok: false, message: better ? 'No better wash left on this plan.' : 'No everyday wash left on this plan.' };
  },

  /** Gives back the plan wash a voided wash used. Safe to repeat. */
  async release(d1: D1Database, shopId: string, jobId: string) {
    const use = await createShopDb(d1, shopId).shopPlanUse.findFirst({ where: { jobId }, select: { id: true, orderId: true, kind: true } });
    if (!use) return;
    const better = usesKind(use.kind) === 'upgrade' ? 1 : 0;
    await runStatements(d1, [
      {
        sql: `UPDATE shop_plan_orders SET washes_used = washes_used - 1, upgrades_used = MAX(0, upgrades_used - ${better}),
                status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
                ended_at = CASE WHEN status = 'ended' THEN NULL ELSE ended_at END
              WHERE shop_id = ? AND id = ? AND washes_used > 0 AND status IN ('active', 'ended')
                AND EXISTS (SELECT 1 FROM shop_plan_uses WHERE shop_id = ? AND id = ?)`,
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
