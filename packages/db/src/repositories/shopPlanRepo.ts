import { istDay, isUpgradeWash, planLastDay, secondCarPlanPrice, shopPlanProblem, type PaymentMethod } from '@mana/domain';
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

/** A vehicle's running shop plan, as New Wash sees it. */
export interface VehicleShopPlan {
  orderId: string;
  title: string;
  washesUsed: number;
  washesTotal: number;
  endsOn: string;
  /** The vehicle it's for. */
  vehicle: { typeId: string; typeName: string; registrationNumber: string };
  /** The branch service this wash is (its better wash every Nth time). */
  service: { id: string; name: string } | null;
  /** Why it can't pay for a wash today; null when it can. */
  problem: string | null;
}

export type ShopPlanResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Wash plans sold at the counter: paid in full when sold (a paid bill, so the cash drawer and
 * Reports count it), for one vehicle, used at the branch that sold it, one wash a day, until it
 * ends (its months from the day it's sold).
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

  /** A vehicle's running shop plans at this branch, and whether each can pay for a wash today. */
  async forVehicle(db: DbClient, registrationNumber: string, now: Date): Promise<VehicleShopPlan[]> {
    const vehicle = await db.vehicle.findFirst({ where: { registrationNumber }, select: { id: true, vehicleTypeId: true } });
    if (!vehicle) return [];
    const type = await db.vehicleType.findUnique({ where: { id: vehicle.vehicleTypeId }, select: { name: true } });
    const orders = await db.shopPlanOrder.findMany({
      where: { vehicleId: vehicle.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (!orders.length) return [];
    const today = istDay(now);
    const [uses, services] = await Promise.all([
      db.shopPlanUse.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, day: today }, select: { orderId: true } }),
      db.service.findMany({
        where: {
          catalogServiceId: { in: [...new Set(orders.flatMap((o) => [o.catalogServiceId, o.upgradeServiceId]).filter((x): x is string => !!x))] },
          active: true,
        },
        select: { id: true, name: true, catalogServiceId: true },
      }),
    ]);
    return orders.map((o) => {
      const catalogId =
        o.upgradeServiceId && o.upgradeEvery && isUpgradeWash(o.washesUsed + 1, { every: o.upgradeEvery }) ? o.upgradeServiceId : o.catalogServiceId;
      const service = services.find((s) => s.catalogServiceId === catalogId) ?? null;
      const problem =
        shopPlanProblem(o, today, uses.some((u) => u.orderId === o.id)) ??
        (service ? null : 'This branch’s menu doesn’t have the wash this plan covers.');
      return {
        orderId: o.id,
        title: o.title,
        washesUsed: o.washesUsed,
        washesTotal: o.washesTotal,
        endsOn: o.endsOn,
        vehicle: { typeId: vehicle.vehicleTypeId, typeName: type?.name ?? 'Vehicle', registrationNumber },
        service: service ? { id: service.id, name: service.name } : null,
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
                  upgrade_service_id, upgrade_every, washes_total, price, payment_method, sale_job_id, starts_on, ends_on, sold_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
   * Uses one wash of a shop plan for a wash: checked again here (this vehicle, not ended, washes
   * left, not already used today), and recorded with the wash so voiding it gives it back.
   */
  async use(
    d1: D1Database,
    shopId: string,
    input: { orderId: string; jobId: string; registrationNumber: string; now: Date },
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
    try {
      await runStatements(d1, [
        {
          sql: `INSERT INTO shop_plan_uses (id, shop_id, order_id, job_id, day)
                SELECT ?, ?, ?, ?, ? WHERE EXISTS (
                  SELECT 1 FROM shop_plan_orders WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total AND ends_on >= ?)`,
          params: [newId(), shopId, order.id, input.jobId, today, shopId, order.id, today],
        },
        {
          sql: `UPDATE shop_plan_orders SET washes_used = washes_used + 1,
                  status = CASE WHEN washes_used + 1 >= washes_total THEN 'ended' ELSE status END,
                  ended_at = CASE WHEN washes_used + 1 >= washes_total THEN ${SQL_NOW} ELSE ended_at END
                WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total
                  AND EXISTS (SELECT 1 FROM shop_plan_uses WHERE shop_id = ? AND job_id = ?)`,
          params: [shopId, order.id, shopId, input.jobId],
        },
      ]);
    } catch (e) {
      if (isUniqueClash(e)) return { ok: false, message: 'This plan was already used today: one wash a day.' };
      throw e;
    }
    const used = await db.shopPlanUse.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    return used ? { ok: true, value: null } : { ok: false, message: 'Every wash on this plan is used.' };
  },

  /** Gives back the plan wash a voided wash used. Safe to repeat. */
  async release(d1: D1Database, shopId: string, jobId: string) {
    const use = await createShopDb(d1, shopId).shopPlanUse.findFirst({ where: { jobId }, select: { id: true, orderId: true } });
    if (!use) return;
    await runStatements(d1, [
      {
        sql: `UPDATE shop_plan_orders SET washes_used = washes_used - 1,
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
