import {
  addDaysTo,
  BRANCH_SERVICES_SELECT,
  branchServicesOf,
  beforeCutoff,
  cancelRefund,
  dayDiff,
  distanceMeters,
  firstWashDay,
  formatClock,
  installmentPlan,
  isDueOn,
  isUpgradeWash,
  isWashing,
  istDay,
  joinDecision,
  MAX_EXTRAS,
  MAX_VEHICLES_PER_JOIN,
  normalizeUnit,
  parseWashDays,
  payDeadline,
  predictedLastWash,
  rangeDays,
  SINGLE_PER_WEEK,
  UNIT_TEXT_MAX,
  unitLabel,
  upcomingWashes,
  type GeoPoint,
  type JoinedVia,
  type MemberCheck,
  type PayMode,
  type VisitOutcome,
  type WashPlanRules,
  SECOND_CAR_PLAN_DISCOUNT_BP,
  secondCarIndexes,
  secondCarPlanPrice,
} from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { isUniqueClash } from '../retryOnClash';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import type { CustomerLink } from './customerAppRepo';
import { planRepo, type PlaceMenu } from './planRepo';
import {
  orderStateSelect,
  orderSummary,
  phaseOf,
  type OrderStateRow,
  placeFail,
  scheduleOf,
  shopContext,
  soldPlan,
} from './placeShared';

/**
 * What each member vehicle bought (a plan or a one-time wash), its payment schedule, and what
 * happens on wash days. Writes go out as one D1 batch, so a join (member, vehicles, orders and
 * their parts) lands whole or not at all.
 */

const LIVE_MEMBER = { in: ['pending', 'active'] };
const LIVE_ORDER = { in: ['waitlist', 'awaiting_payment', 'active'] };
/** How far ahead a full place looks for a free wash day before putting an order on the waiting list. */
const CAPACITY_LOOKAHEAD = 16;
/** Visits can be recorded (or undone) for wash days this far back, in case the phone was offline. */
const VISIT_BACKDATE_DAYS = 3;
const MAX_PAUSE_DAYS = 60;

export type WashChoice =
  | { kind: 'plan'; planId: string; payMode: PayMode }
  | { kind: 'single'; serviceIds: string[] };

export interface JoinVehicle {
  /** A new vehicle: just its type (the washer records the plate at the first wash). */
  vehicleTypeId: string | null;
  /** One of the customer's vehicles at this branch (Flow D). */
  vehicleId: string | null;
  choice: WashChoice;
}

export interface JoinInput {
  placeId: string;
  phone: string;
  name: string | null;
  /** Needed for a new member; ignored when they are already a member (adding vehicles). */
  unit: { unitId: string } | { text: string } | null;
  distanceM: number | null;
  via: JoinedVia;
  byUserId: string | null;
  parkingNote: string | null;
  vehicles: JoinVehicle[];
  now: Date;
}

interface PricedOrder {
  kind: 'plan' | 'single';
  planId: string | null;
  title: string;
  snapshot: string;
  washesTotal: number;
  months: number;
  perWeek: number;
  singlePrice: number;
  total: number;
  payMode: PayMode;
}

/** The order for one vehicle and choice, priced from the branch menu (never from the app). */
function priceChoice(menu: PlaceMenu, rules: WashPlanRules, vehicleTypeId: string, choice: WashChoice): PricedOrder {
  const type = menu.vehicleTypes.find((t) => t.id === vehicleTypeId);
  if (!type) return placeFail('invalid', 'Pick the vehicle type again.');
  const vehicleType = { id: type.id, name: type.name, category: type.category };
  const ruleSnapshot = {
    graceDays: rules.graceDays,
    refundRule: rules.refundRule,
    gstRateBp: rules.gstRateBp,
    skipsPerMonth: rules.skipsPerMonth,
    pauseDaysPerMonth: rules.pauseDaysPerMonth,
  };
  // The neighbours discount the price was worked out with, kept with the order.
  const join = menu.join ? { joined: menu.join.joined, flats: menu.join.flats, discountBp: menu.join.discountBp } : null;
  if (choice.kind === 'plan') {
    const plan = menu.plans.find((p) => p.id === choice.planId);
    if (!plan) return placeFail('invalid', 'This plan isn’t available any more. Pick again.');
    const price = plan.prices.find((p) => p.vehicleTypeId === vehicleTypeId);
    if (!price) return placeFail('not_allowed', `The team here doesn’t wash a ${type.name} on the ${plan.name} plan.`);
    const upgrade = plan.upgrade;
    return {
      kind: 'plan',
      planId: plan.id,
      title: `${plan.name} · ${upgrade ? `${plan.serviceName} + ${upgrade.name}` : plan.serviceName}`,
      snapshot: JSON.stringify({
        vehicleType,
        plan: {
          id: plan.id,
          name: plan.name,
          washes: plan.washes,
          months: plan.months,
          discountBp: plan.discountBp,
          upgrade,
          listTotal: price.listTotal,
          fullTotal: price.fullTotal,
        },
        items: [{ name: plan.serviceName, price: price.perWash }],
        priceMode: menu.priceMode,
        join,
        rules: ruleSnapshot,
      }),
      washesTotal: plan.washes,
      months: plan.months,
      perWeek: plan.perWeek,
      singlePrice: price.perWash,
      total: price.total,
      payMode: plan.allowParts ? choice.payMode : 'full',
    };
  }
  const ids = [...new Set(choice.serviceIds)];
  if (!ids.length || ids.length > MAX_EXTRAS + 1) return placeFail('invalid', 'Pick the wash you want.');
  const items = ids.map((id) => {
    const service = menu.services.find((s) => s.id === id);
    const price = service?.prices.find((p) => p.vehicleTypeId === vehicleTypeId);
    if (!service || !price) return placeFail('not_allowed', `The team here doesn’t do that for a ${type.name}.`);
    return { serviceId: service.id, name: service.name, price: price.price };
  });
  const total = items.reduce((n, i) => n + i.price, 0);
  return {
    kind: 'single',
    planId: null,
    title: items.map((i) => i.name).join(' + '),
    snapshot: JSON.stringify({ vehicleType, plan: null, items, priceMode: menu.priceMode, join, rules: ruleSnapshot }),
    washesTotal: 1,
    months: 1,
    perWeek: SINGLE_PER_WEEK,
    singlePrice: total,
    total,
    payMode: 'full',
  };
}

/** A plan for the second car in the same home: 10% off, noted on the order and its receipt. */
function asSecondCar(o: PricedOrder): PricedOrder {
  const total = secondCarPlanPrice(o.total);
  const snapshot = JSON.parse(o.snapshot) as Record<string, unknown>;
  return {
    ...o,
    title: `${o.title} · second car 10% off`,
    snapshot: JSON.stringify({ ...snapshot, secondCar: { discountBp: SECOND_CAR_PLAN_DISCOUNT_BP, fullTotal: o.total } }),
    total,
  };
}

type Priced = { total: number; payMode: PayMode; months: number };

function installmentsOf(o: Priced, firstWashOn: string, rules: WashPlanRules) {
  return installmentPlan({ total: o.total, mode: o.payMode, firstDueOn: addDaysTo(firstWashOn, -1), months: o.months, rules });
}

function installmentRows(shopId: string, orderId: string, o: Priced, firstWashOn: string, rules: WashPlanRules) {
  const plan = installmentsOf(o, firstWashOn, rules);
  return insertRows(
    'order_installments',
    ['id', 'shop_id', 'order_id', 'seq', 'amount', 'due_on'],
    plan.map((i) => [newId(), shopId, orderId, i.seq, i.amount, i.dueOn]),
  );
}

type PlaceForLoad = { id: string; washDays: string; capacity: number | null };

/**
 * Vehicles already due at a place on a day (paid and waiting for payment), so a full place
 * pushes new orders to a later wash day or the waiting list.
 */
async function loadCounter(db: DbClient, place: PlaceForLoad) {
  const washDays = parseWashDays(place.washDays);
  const orders =
    place.capacity == null
      ? []
      : await db.placeOrder.findMany({
          where: { member: { placeId: place.id, status: LIVE_MEMBER }, status: { in: ['active', 'awaiting_payment'] } },
          select: orderStateSelect,
        });
  const added = new Map<string, number>();
  const count = (day: string) =>
    orders.filter((o) => (o.status === 'awaiting_payment' ? o.firstWashOn === day : isDueOn(scheduleOf(o, washDays, day), day)))
      .length + (added.get(day) ?? 0);
  return {
    washDays,
    /** The first wash day with room, or null (waiting list). Counts the order as added. */
    pick(perWeek: number, now: Date, rules: WashPlanRules, after: string | null = null): string | null {
      let from = after;
      for (let i = 0; i < CAPACITY_LOOKAHEAD; i++) {
        const day = firstWashDay({ washDays, perWeek, now, rules, after: from });
        if (!day) return null;
        if (place.capacity == null || count(day) < place.capacity) {
          added.set(day, (added.get(day) ?? 0) + 1);
          return day;
        }
        from = day;
      }
      return null;
    },
  };
}

const orderDetailSelect = {
  ...orderStateSelect,
  shopId: true,
  customerId: true,
  memberId: true,
  memberVehicleId: true,
  planId: true,
  snapshot: true,
  member: {
    select: {
      id: true,
      status: true,
      placeId: true,
      place: { select: { id: true, label: true, name: true, washDays: true, washTime: true, status: true, capacity: true } },
    },
  },
  memberVehicle: {
    select: {
      id: true,
      vehicleTypeId: true,
      vehicleId: true,
      vehicleType: { select: { name: true, category: true } },
      vehicle: { select: { registrationNumber: true, make: true, model: true } },
    },
  },
  payments: {
    where: { status: 'paid' },
    orderBy: { paidAt: 'asc' as const },
    select: { id: true, amount: true, refunded: true, receiptNo: true, paidAt: true, method: true },
  },
} as const;

async function loadOrder(db: DbClient, orderId: string) {
  return db.placeOrder.findUnique({ where: { id: orderId }, select: orderDetailSelect });
}

type OrderDetailRow = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

/** A running plan as New Wash sees it. `problem` says why it can't pay for a wash today. */
export interface ShopPlan {
  orderId: string;
  placeName: string;
  unit: string | null;
  planName: string;
  vehicle: { typeId: string; typeName: string; registrationNumber: string | null };
  washesUsed: number;
  washesTotal: number;
  service: { id: string; name: string } | null;
  problem: string | null;
}

function parseSnapshot(text: string): { plan?: { name?: string } | null } {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as { plan?: { name?: string } | null }) : {};
  } catch {
    return {};
  }
}

function shopWashProblem(o: OrderStateRow, rules: WashPlanRules, today: string, covered: boolean): string | null {
  if (o.status !== 'active' || !isWashing(phaseOf(o, rules, today))) return 'This plan isn’t paid up, so it can’t be used today.';
  if (o.washesUsed >= o.washesTotal) return 'Every wash on this plan is used.';
  if (o.visits.some((v) => v.date === today)) return 'This plan was already used today.';
  if (!covered) return 'This branch’s menu doesn’t have the wash this plan covers.';
  return null;
}

function orderDetailView(o: OrderDetailRow, rules: WashPlanRules, now: Date) {
  const summary = orderSummary(o, o.member.place.washDays, rules, now);
  return {
    ...summary,
    memberId: o.memberId,
    memberStatus: o.member.status,
    place: { id: o.member.place.id, label: o.member.place.label, name: o.member.place.name, washTime: o.member.place.washTime },
    vehicle: {
      memberVehicleId: o.memberVehicle.id,
      typeName: o.memberVehicle.vehicleType.name,
      category: o.memberVehicle.vehicleType.category === 'bike' ? ('bike' as const) : ('car' as const),
      registrationNumber: o.memberVehicle.vehicle?.registrationNumber ?? null,
      make: o.memberVehicle.vehicle?.make ?? null,
      model: o.memberVehicle.vehicle?.model ?? null,
    },
    payBy: o.status === 'awaiting_payment' && summary.firstWashOn ? payDeadline(summary.firstWashOn, rules).toISOString() : null,
    receipts: o.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      refunded: p.refunded,
      receiptNo: p.receiptNo,
      paidAt: p.paidAt?.toISOString() ?? null,
      method: p.method,
    })),
  };
}

export type PlaceOrderView = ReturnType<typeof orderDetailView>;

export const placeOrderRepo = {
  /**
   * Joins a place (or adds vehicles for a member): the customer at the branch (made if new), the
   * membership, each vehicle and its order with the payment parts. People at the place, or added
   * there by the team, are in at once; anyone else waits for the team (orders are made, payment
   * opens once confirmed).
   */
  async join(d1: D1Database, input: JoinInput) {
    const pdb = createPlatformDb(d1);
    const place = await pdb.place.findUnique({
      where: { id: input.placeId },
      select: { id: true, shopId: true, status: true, stage: true, washDays: true, capacity: true, needsApproval: true, label: true },
    });
    if (!place || place.status === 'closed' || place.stage !== 'live') return placeFail('not_found', 'This place isn’t served any more.');
    const branchServices = await pdb.shop.findUnique({ where: { id: place.shopId }, select: BRANCH_SERVICES_SELECT });
    if (!branchServices || !branchServicesOf(branchServices).live.community) {
      return placeFail('not_allowed', 'This branch isn’t taking community members right now.');
    }
    if (place.status !== 'active') return placeFail('not_allowed', `We’ve paused washes at ${place.label} for now.`);
    if (!input.vehicles.length || input.vehicles.length > MAX_VEHICLES_PER_JOIN) {
      return placeFail('invalid', `Add between 1 and ${MAX_VEHICLES_PER_JOIN} vehicles.`);
    }
    const shopId = place.shopId;
    const { shop, rules } = await shopContext(pdb, shopId);
    const db = createShopDb(d1, shopId);

    // The customer at this branch: the same person whichever way they joined.
    let customer = await db.customer.findFirst({ where: { phone: input.phone }, select: { id: true, name: true } });
    const newCustomer = !customer;
    if (!customer) {
      await runStatements(d1, [
        {
          sql: `INSERT INTO customers (id, shop_id, name, phone, source) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (shop_id, phone) DO NOTHING`,
          params: [newId(), shopId, input.name, input.phone, input.via === 'staff' ? 'community' : 'community_app'],
        },
      ]);
      customer = await db.customer.findFirst({ where: { phone: input.phone }, select: { id: true, name: true } });
      if (!customer) return placeFail('busy', 'Please try again.');
    } else if (!customer.name && input.name) {
      await db.customer.update({ where: { id: customer.id }, data: { name: input.name } });
    }

    const statements: SqlStatement[] = [];
    let member = await db.placeMember.findFirst({
      where: { placeId: place.id, customerId: customer.id, status: LIVE_MEMBER },
      select: { id: true, status: true, checks: true },
    });
    let checks: MemberCheck[] = [];
    if (member?.status === 'pending' && input.via === 'staff') {
      // They asked in the app and the team is now at their door: that's the confirmation.
      statements.push({
        sql: `UPDATE place_members SET status = 'active', handled_by_user_id = ?, handled_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND status = 'pending'`,
        params: [input.byUserId, shopId, member.id],
      });
      member = { ...member, status: 'active' };
    }
    if (!member) {
      if (!input.unit) return placeFail('invalid', 'Pick your flat or house.');
      let unitId: string | null = null;
      let unitText: string | null = null;
      if ('unitId' in input.unit) {
        const unit = await db.placeUnit.findFirst({ where: { id: input.unit.unitId, placeId: place.id, archivedAt: null }, select: { id: true } });
        if (!unit) return placeFail('invalid', 'Pick your flat again.');
        unitId = unit.id;
      } else {
        unitText = normalizeUnit(input.unit.text);
        if (!unitText || unitText.length > UNIT_TEXT_MAX) return placeFail('invalid', 'Type your flat or house number.');
      }
      const unitTaken =
        (await db.placeMember.count({
          where: { placeId: place.id, status: LIVE_MEMBER, ...(unitId ? { unitId } : { unitText }) },
        })) > 0;
      const decision = joinDecision({
        distanceM: input.distanceM,
        atPlaceMeters: rules.atPlaceMeters,
        needsApproval: place.needsApproval,
        unitTaken,
        byStaff: input.via === 'staff',
      });
      checks = decision.checks;
      member = { id: newId(), status: decision.status, checks: checks.join(',') || null };
      statements.push({
        sql: `INSERT INTO place_members (id, shop_id, place_id, customer_id, unit_id, unit_text, status, joined_via, distance_m,
                checks, parking_note, added_by_user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          member.id,
          shopId,
          place.id,
          customer.id,
          unitId,
          unitText,
          member.status,
          input.via,
          input.distanceM,
          member.checks,
          input.parkingNote,
          input.byUserId,
        ],
      });
    }

    // The customer's own vehicles (Flow D) keep their type; a vehicle has one live order at a time.
    const vehicleIds = input.vehicles.map((v) => v.vehicleId).filter((id): id is string => !!id);
    const owned = vehicleIds.length
      ? await db.vehicle.findMany({ where: { id: { in: vehicleIds }, customerId: customer.id }, select: { id: true, vehicleTypeId: true, registrationNumber: true } })
      : [];
    const linked = vehicleIds.length
      ? await db.memberVehicle.findMany({
          where: { vehicleId: { in: vehicleIds }, status: 'active' },
          select: { id: true, memberId: true, vehicleId: true, orders: { where: { status: LIVE_ORDER }, select: { id: true } } },
        })
      : [];
    if (new Set(vehicleIds).size !== vehicleIds.length) return placeFail('invalid', 'The same vehicle is in the list twice.');

    const full = await planRepo.menu(pdb, shopId, shop.businessId, rules.priceMode, place.id);
    // Customers joining in the app can't buy what HQ keeps for staff to sell.
    const menu = input.via === 'staff' ? full : { ...full, services: full.services.filter((s) => s.showInApp) };
    const counter = await loadCounter(db, place);
    // A second car in the same home gets 10% off its plan: every new plan when the customer already
    // has one running, otherwise all but the dearest plan in this join.
    const prePriced = input.vehicles.map((v) => {
      const typeId = v.vehicleId ? owned.find((o) => o.id === v.vehicleId)?.vehicleTypeId : v.vehicleTypeId;
      return typeId && v.choice.kind === 'plan' ? priceChoice(menu, rules, typeId, v.choice).total : null;
    });
    const planAt = prePriced.flatMap((t, i) => (t == null ? [] : [i]));
    const hasPlan = planAt.length ? await planRepo.customerHasPlan(db, customer.id) : false;
    const secondCar = new Set([...secondCarIndexes(planAt.map((i) => prePriced[i]!), hasPlan)].map((k) => planAt[k]!));
    const orders: { id: string; title: string; total: number; dueNow: number; firstWashOn: string | null; status: string; kind: string }[] = [];
    for (const [index, v] of input.vehicles.entries()) {
      let memberVehicleId = newId();
      let reused = false;
      let vehicleTypeId = v.vehicleTypeId;
      if (v.vehicleId) {
        const vehicle = owned.find((o) => o.id === v.vehicleId);
        if (!vehicle) return placeFail('invalid', 'Pick your vehicle again.');
        vehicleTypeId = vehicle.vehicleTypeId;
        const link = linked.find((l) => l.vehicleId === v.vehicleId);
        if (link?.orders.length) return placeFail('conflict', `${vehicle.registrationNumber} already has a plan running.`);
        if (link && link.memberId === member.id) {
          memberVehicleId = link.id;
          reused = true;
        } else if (link) {
          // Moved: the vehicle now belongs to this place.
          statements.push({ sql: 'UPDATE member_vehicles SET status = ? WHERE shop_id = ? AND id = ?', params: ['removed', shopId, link.id] });
        }
      }
      if (!vehicleTypeId) return placeFail('invalid', 'Pick the vehicle type.');
      const base = priceChoice(menu, rules, vehicleTypeId, v.choice);
      const priced = secondCar.has(index) && base.kind === 'plan' ? asSecondCar(base) : base;
      if (!reused) {
        statements.push({
          sql: `INSERT INTO member_vehicles (id, shop_id, member_id, customer_id, vehicle_type_id, vehicle_id) VALUES (?, ?, ?, ?, ?, ?)`,
          params: [memberVehicleId, shopId, member.id, customer.id, vehicleTypeId, v.vehicleId],
        });
      }
      const firstWashOn = counter.pick(priced.perWeek, input.now, rules);
      const orderId = newId();
      const status = firstWashOn ? 'awaiting_payment' : 'waitlist';
      statements.push({
        sql: `INSERT INTO place_orders (id, shop_id, customer_id, member_id, member_vehicle_id, kind, plan_id, title, snapshot,
                washes_total, months, per_week, single_price, total, pay_mode, status, first_wash_on)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          orderId,
          shopId,
          customer.id,
          member.id,
          memberVehicleId,
          priced.kind,
          priced.planId,
          priced.title,
          priced.snapshot,
          priced.washesTotal,
          priced.months,
          priced.perWeek,
          priced.singlePrice,
          priced.total,
          priced.payMode,
          status,
          firstWashOn,
        ],
      });
      if (firstWashOn) statements.push(...installmentRows(shopId, orderId, priced, firstWashOn, rules));
      const dueNow = firstWashOn ? installmentsOf(priced, firstWashOn, rules)[0]!.amount : priced.total;
      orders.push({ id: orderId, title: priced.title, total: priced.total, dueNow, firstWashOn, status, kind: priced.kind });
    }

    try {
      await runStatements(d1, statements);
    } catch (e) {
      if (isUniqueClash(e)) return placeFail('busy', 'Your join is already being saved. Pull down to refresh.');
      throw e;
    }
    return {
      shopId,
      customerId: customer.id,
      newCustomer,
      memberId: member.id,
      memberStatus: member.status as 'pending' | 'active',
      checks: checks.length ? checks : (member.checks?.split(',') as MemberCheck[] | undefined) ?? [],
      orders: orders.map((o) => ({
        ...o,
        payBy: o.firstWashOn ? payDeadline(o.firstWashOn, rules).toISOString() : null,
      })),
    };
  },

  async detail(d1: D1Database, shopId: string, orderId: string, now: Date) {
    const o = await loadOrder(createShopDb(d1, shopId), orderId);
    if (!o) return null;
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    return orderDetailView(o, rules, now);
  },

  /** Money in from community plans in `[from, to)`: payments by when they were paid, less refunds by when they went out. */
  async income(db: DbClient, from: Date, to: Date): Promise<{ amount: number; count: number }> {
    const [paid, refunded] = await Promise.all([
      db.customerPayment.aggregate({
        where: { status: 'paid', paidAt: { gte: from, lt: to } },
        _sum: { amount: true },
        _count: true,
      }),
      db.customerRefund.aggregate({
        where: { status: 'processed', processedAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    ]);
    return { amount: (paid._sum.amount ?? 0) - (refunded._sum.amount ?? 0), count: paid._count };
  },

  /** A customer's communities at this branch for their profile: where they live, what they're on, what they paid. */
  async forCustomer(d1: D1Database, shopId: string, customerId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const members = await db.placeMember.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        joinedVia: true,
        unitText: true,
        createdAt: true,
        unit: { select: { block: true, number: true } },
        place: { select: { id: true, label: true, name: true } },
      },
    });
    if (!members.length) return [];
    const orders = await db.placeOrder.findMany({
      where: { memberId: { in: members.map((m) => m.id) } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: orderDetailSelect,
    });
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    return members.map((m) => ({
      memberId: m.id,
      place: { id: m.place.id, name: m.place.name || m.place.label },
      unit: m.unit ? unitLabel(m.unit.block, m.unit.number) : m.unitText,
      status: m.status,
      joinedVia: m.joinedVia,
      since: m.createdAt.toISOString(),
      orders: orders.filter((o) => o.memberId === m.id).map((o) => orderDetailView(o, rules, now)),
    }));
  },

  /** One of this customer's orders, from whichever of their branches has it. */
  async findForCustomer(d1: D1Database, links: CustomerLink[], orderId: string) {
    for (const link of links) {
      const o = await createShopDb(d1, link.shopId).placeOrder.findFirst({
        where: { id: orderId, customerId: link.customerId },
        select: { id: true },
      });
      if (o) return link;
    }
    return null;
  },

  /** A customer skipping one wash (before the cut-off the evening before). */
  async skip(d1: D1Database, shopId: string, orderId: string, day: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const o = await loadOrder(db, orderId);
    if (!o || o.status !== 'active') return placeFail('not_allowed', 'Only a running plan can skip a wash.');
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    const view = orderDetailView(o, rules, now);
    if (o.kind !== 'plan') return placeFail('not_allowed', 'A one-time wash can be cancelled instead.');
    const today = istDay(now);
    const upcoming = upcomingWashes(scheduleOf(o, parseWashDays(o.member.place.washDays), today), today, 8);
    if (!upcoming.includes(day)) return placeFail('invalid', 'That isn’t one of your wash days.');
    if (!beforeCutoff(day, now, rules)) return placeFail('not_allowed', `Washes can be skipped until ${formatClock(rules.skipCutoffTime)} the evening before.`);
    if (view.skipsLeft <= 0) return placeFail('not_allowed', 'You’ve used all the skips on this plan. You can pause it instead.');
    try {
      await runStatements(d1, [
        {
          sql: `INSERT INTO place_visits (id, shop_id, place_id, order_id, member_vehicle_id, date, outcome, by_customer)
                VALUES (?, ?, ?, ?, ?, ?, 'skipped', 1)`,
          params: [newId(), shopId, o.member.placeId, o.id, o.memberVehicleId, day],
        },
      ]);
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
    }
  },

  async unskip(d1: D1Database, shopId: string, orderId: string, day: string, now: Date) {
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    if (!beforeCutoff(day, now, rules)) return placeFail('not_allowed', 'It’s too late to change this wash.');
    await createShopDb(d1, shopId).placeVisit.deleteMany({ where: { orderId, date: day, outcome: 'skipped', byCustomer: true } });
  },

  /** A holiday: no washes between the two days; the plan runs on after. */
  async pause(d1: D1Database, shopId: string, orderId: string, range: { fromOn: string; toOn: string }, now: Date) {
    const db = createShopDb(d1, shopId);
    const o = await loadOrder(db, orderId);
    if (!o || o.status !== 'active' || o.kind !== 'plan') return placeFail('not_allowed', 'Only a running plan can be paused.');
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    if (range.toOn < range.fromOn) return placeFail('invalid', 'The pause ends before it starts.');
    if (!beforeCutoff(range.fromOn, now, rules)) {
      return placeFail('not_allowed', `A pause can start from a day after ${formatClock(rules.skipCutoffTime)} today.`);
    }
    const days = rangeDays(range);
    const view = orderDetailView(o, rules, now);
    if (days > Math.min(MAX_PAUSE_DAYS, view.pauseDaysLeft)) {
      return placeFail('not_allowed', `You can pause for up to ${view.pauseDaysLeft} more days on this plan.`);
    }
    if (o.pauses.some((p) => p.fromOn <= range.toOn && range.fromOn <= p.toOn)) {
      return placeFail('conflict', 'This overlaps a pause you already have.');
    }
    await runStatements(d1, [
      {
        sql: 'INSERT INTO order_pauses (id, shop_id, order_id, from_on, to_on) VALUES (?, ?, ?, ?, ?)',
        params: [newId(), shopId, o.id, range.fromOn, range.toOn],
      },
    ]);
  },

  /** Ends a pause: one not started yet is dropped; a running one ends today. */
  async endPause(d1: D1Database, shopId: string, orderId: string, pauseId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const pause = await db.orderPause.findFirst({ where: { id: pauseId, orderId, cancelledAt: null } });
    if (!pause) return placeFail('not_found', 'Pause not found.');
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    const today = istDay(now);
    if (beforeCutoff(pause.fromOn, now, rules)) {
      await db.orderPause.updateMany({ where: { id: pauseId }, data: { cancelledAt: now } });
    } else if (pause.toOn > today) {
      await db.orderPause.updateMany({ where: { id: pauseId }, data: { toOn: today } });
    }
  },

  /**
   * Cancels an order. Before any wash everything paid comes back; after, the washes given are
   * charged by the refund rule. Returns what to refund — the caller sends it through Razorpay.
   */
  async cancel(
    d1: D1Database,
    shopId: string,
    orderId: string,
    data: { by: 'customer' | 'staff' | 'system'; reason: string | null; now: Date },
  ): Promise<{ refund: number; charged: number } | null> {
    const db = createShopDb(d1, shopId);
    const o = await db.placeOrder.findUnique({ where: { id: orderId }, select: orderStateSelect });
    if (!o || !['waitlist', 'awaiting_payment', 'active'].includes(o.status)) return null;
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    const paid = o.installments.filter((i) => i.status === 'paid').reduce((n, i) => n + i.amount, 0);
    const { refund, charged } = cancelRefund({
      paid,
      total: o.total,
      washesTotal: o.washesTotal,
      washesUsed: o.washesUsed,
      singlePrice: o.singlePrice,
      rule: rules.refundRule,
    });
    const iso = data.now.toISOString();
    await runStatements(d1, [
      {
        sql: `UPDATE place_orders SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, refund_due = ?,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND status IN ('waitlist', 'awaiting_payment', 'active')`,
        params: [iso, data.by, data.reason, refund, shopId, orderId],
      },
      { sql: `UPDATE order_installments SET status = 'cancelled' WHERE shop_id = ? AND order_id = ? AND status = 'due'`, params: [shopId, orderId] },
      { sql: `UPDATE customer_payments SET status = 'expired' WHERE shop_id = ? AND order_id = ? AND status = 'created'`, params: [shopId, orderId] },
      { sql: `DELETE FROM place_visits WHERE shop_id = ? AND order_id = ? AND outcome = 'skipped' AND date >= ?`, params: [shopId, orderId, istDay(data.now)] },
    ]);
    return { refund, charged };
  },

  /** A new order for the same vehicle and plan, starting after the current one's last wash. */
  async renew(d1: D1Database, shopId: string, orderId: string, payMode: PayMode, now: Date) {
    const db = createShopDb(d1, shopId);
    const o = await loadOrder(db, orderId);
    if (!o || o.kind !== 'plan' || !o.planId || !['active', 'ended'].includes(o.status)) {
      return placeFail('not_allowed', 'Only a plan can be renewed.');
    }
    if (o.member.status !== 'active' || o.member.place.status !== 'active') return placeFail('not_allowed', 'This place isn’t taking renewals right now.');
    const existing = await db.placeOrder.count({ where: { renewalOf: o.id, status: { not: 'cancelled' } } });
    if (existing) return placeFail('conflict', 'This plan is already renewed.');
    const pdb = createPlatformDb(d1);
    const { shop, rules } = await shopContext(pdb, shopId);
    const menu = await planRepo.menu(pdb, shopId, shop.businessId, rules.priceMode, o.member.placeId);
    const priced = priceChoice(menu, rules, o.memberVehicle.vehicleTypeId, { kind: 'plan', planId: o.planId, payMode });
    const today = istDay(now);
    const after = o.status === 'active' ? predictedLastWash(scheduleOf(o, parseWashDays(o.member.place.washDays), today), today) : null;
    const counter = await loadCounter(db, o.member.place);
    const firstWashOn = counter.pick(priced.perWeek, now, rules, after);
    const id = newId();
    try {
      await runStatements(d1, [
        {
          sql: `INSERT INTO place_orders (id, shop_id, customer_id, member_id, member_vehicle_id, kind, plan_id, title, snapshot,
                  washes_total, months, per_week, single_price, total, pay_mode, status, first_wash_on, renewal_of)
                VALUES (?, ?, ?, ?, ?, 'plan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            id,
            shopId,
            o.customerId,
            o.memberId,
            o.memberVehicleId,
            priced.planId,
            priced.title,
            priced.snapshot,
            priced.washesTotal,
            priced.months,
            priced.perWeek,
            priced.singlePrice,
            priced.total,
            priced.payMode,
            firstWashOn ? 'awaiting_payment' : 'waitlist',
            firstWashOn,
            o.id,
          ],
        },
        ...(firstWashOn ? installmentRows(shopId, id, priced, firstWashOn, rules) : []),
      ]);
    } catch (e) {
      if (isUniqueClash(e)) return placeFail('conflict', 'This plan is already renewed.');
      throw e;
    }
    return id;
  },

  /**
   * The washer records a wash day for one vehicle. "done" uses a wash (and records the plate at
   * the first wash); "not_found" sends the member back to the team; "missed" is our side. All
   * three keep the plan running — only "done" counts.
   */
  async recordVisit(
    d1: D1Database,
    shopId: string,
    input: {
      placeId: string;
      orderId: string;
      date: string;
      outcome: Exclude<VisitOutcome, 'skipped'>;
      byUserId: string;
      note: string | null;
      plate: { registrationNumber: string; make: string | null; model: string | null } | null;
      /** Where the washer's phone was; null when they didn't share it. */
      at: GeoPoint | null;
      now: Date;
    },
  ): Promise<{ ended: boolean; memberId: string; visitId: string; distanceM: number | null }> {
    const db = createShopDb(d1, shopId);
    const o = await loadOrder(db, input.orderId);
    if (!o || o.member.placeId !== input.placeId) return placeFail('not_found', 'This vehicle isn’t on this place’s list.');
    const today = istDay(input.now);
    if (input.date > today || dayDiff(input.date, today) > VISIT_BACKDATE_DAYS) {
      return placeFail('invalid', 'Washes can be recorded for today or the last few days.');
    }
    if (o.visits.some((v) => v.date === input.date)) return placeFail('conflict', 'This wash day is already recorded.');
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    const statements: SqlStatement[] = [];
    let ended = false;
    if (input.outcome === 'done') {
      if (o.status !== 'active' || !isWashing(phaseOf(o, rules, input.date))) {
        return placeFail('not_allowed', 'This vehicle isn’t paid. Please don’t wash it.');
      }
      if (o.washesUsed >= o.washesTotal) return placeFail('not_allowed', 'Every wash on this order is used.');
      ended = o.washesUsed + 1 >= o.washesTotal;
      statements.push({
        sql: `UPDATE place_orders SET washes_used = washes_used + 1,
                status = CASE WHEN washes_used + 1 >= washes_total THEN 'ended' ELSE status END,
                ended_at = CASE WHEN washes_used + 1 >= washes_total THEN ? ELSE ended_at END,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total`,
        params: [input.now.toISOString(), shopId, o.id],
      });
      if (input.plate && !o.memberVehicle.vehicleId) {
        const existing = await db.vehicle.findFirst({
          where: { registrationNumber: input.plate.registrationNumber },
          select: { id: true, customerId: true },
        });
        if (existing && existing.customerId !== o.customerId) {
          return placeFail('conflict', 'This number is saved for another customer. Ask the office to check, then try again.');
        }
        const vehicleId = existing?.id ?? newId();
        if (!existing) {
          statements.push({
            sql: `INSERT INTO vehicles (id, shop_id, customer_id, registration_number, make, model, vehicle_type_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            params: [vehicleId, shopId, o.customerId, input.plate.registrationNumber, input.plate.make, input.plate.model, o.memberVehicle.vehicleTypeId],
          });
        }
        statements.push({ sql: 'UPDATE member_vehicles SET vehicle_id = ? WHERE shop_id = ? AND id = ?', params: [vehicleId, shopId, o.memberVehicle.id] });
      }
    }
    const place = input.at ? await db.place.findUnique({ where: { id: input.placeId }, select: { latitude: true, longitude: true } }) : null;
    const distanceM = place && input.at ? distanceMeters(place, input.at) : null;
    const visitId = newId();
    statements.push({
      sql: `INSERT INTO place_visits (id, shop_id, place_id, order_id, member_vehicle_id, date, outcome, by_user_id, note, distance_m)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [visitId, shopId, input.placeId, o.id, o.memberVehicle.id, input.date, input.outcome, input.byUserId, input.note, distanceM],
    });
    if (input.outcome === 'not_found') {
      const m = await db.placeMember.findUnique({ where: { id: o.memberId }, select: { checks: true } });
      const checks = [...new Set([...(m?.checks?.split(',').filter(Boolean) ?? []), 'not_found'])].join(',');
      statements.push({
        sql: `UPDATE place_members SET checks = ?, status = 'pending', handled_at = NULL, handled_by_user_id = NULL
              WHERE shop_id = ? AND id = ? AND status = 'active'`,
        params: [checks, shopId, o.memberId],
      });
    }
    try {
      await runStatements(d1, statements);
    } catch (e) {
      if (isUniqueClash(e)) return placeFail('conflict', 'This vehicle number is already linked to another member.');
      throw e;
    }
    return { ended, memberId: o.memberId, visitId, distanceM };
  },

  /**
   * A customer's running plans, for New Wash: whether each can pay for a wash at the shop today,
   * and which of the branch's services it covers.
   */
  async shopPlans(d1: D1Database, shopId: string, phone: string, now: Date): Promise<ShopPlan[]> {
    const db = createShopDb(d1, shopId);
    const customer = await db.customer.findFirst({ where: { phone }, select: { id: true } });
    if (!customer) return [];
    const orders = await db.placeOrder.findMany({
      where: { customerId: customer.id, kind: 'plan', status: 'active', member: { status: 'active' } },
      orderBy: { createdAt: 'asc' },
      select: {
        ...orderDetailSelect,
        member: { select: { ...orderDetailSelect.member.select, unitText: true, unit: { select: { block: true, number: true } } } },
      },
    });
    if (!orders.length) return [];
    const pdb = createPlatformDb(d1);
    const { rules } = await shopContext(pdb, shopId);
    const planIds = [...new Set(orders.map((o) => o.planId).filter((id): id is string => !!id))];
    const plans = await pdb.washPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, catalogServiceId: true, shopUse: true } });
    const sold = new Map(orders.map((o) => [o.id, soldPlan(o.snapshot)]));
    const catalogIds = [
      ...plans.map((p) => p.catalogServiceId),
      ...[...sold.values()].map((s) => s.upgrade?.catalogServiceId).filter((id): id is string => !!id),
    ];
    const services = await db.service.findMany({
      where: { catalogServiceId: { in: [...new Set(catalogIds)] }, active: true },
      select: { id: true, name: true, catalogServiceId: true },
    });
    const today = istDay(now);
    return orders.map((o) => {
      const upgrade = sold.get(o.id)?.upgrade;
      const catalogId =
        upgrade?.catalogServiceId && isUpgradeWash(o.washesUsed + 1, upgrade)
          ? upgrade.catalogServiceId
          : plans.find((p) => p.id === o.planId)?.catalogServiceId;
      const service = services.find((s) => s.catalogServiceId === catalogId) ?? null;
      const snapshot = parseSnapshot(o.snapshot);
      const usable =
        plans.find((p) => p.id === o.planId)?.shopUse === false
          ? 'This plan is used at its community only, not at the shop.'
          : shopWashProblem(o, rules, today, service != null);
      return {
        orderId: o.id,
        placeName: o.member.place.name || o.member.place.label,
        unit: o.member.unit ? unitLabel(o.member.unit.block, o.member.unit.number) : o.member.unitText,
        planName: snapshot.plan?.name ?? o.title,
        vehicle: {
          typeId: o.memberVehicle.vehicleTypeId,
          typeName: o.memberVehicle.vehicleType.name,
          registrationNumber: o.memberVehicle.vehicle?.registrationNumber ?? null,
        },
        washesUsed: o.washesUsed,
        washesTotal: o.washesTotal,
        service: service ? { id: service.id, name: service.name } : null,
        problem: usable,
      };
    });
  },

  /**
   * Uses one wash of a plan for a wash at the shop: the covered service is free on the bill.
   * Recorded as the plan's wash for today, linked to the shop wash so voiding it gives it back.
   */
  async useAtShop(
    d1: D1Database,
    shopId: string,
    input: { orderId: string; jobId: string; phone: string; byUserId: string; now: Date },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const db = createShopDb(d1, shopId);
    const mine = await db.placeVisit.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    if (mine) return { ok: true };
    const o = await loadOrder(db, input.orderId);
    const customer = await db.customer.findFirst({ where: { phone: input.phone }, select: { id: true } });
    if (!o || o.kind !== 'plan' || !customer || o.customerId !== customer.id) {
      return { ok: false, message: 'This plan isn’t this customer’s. Check the phone number.' };
    }
    const today = istDay(input.now);
    const { rules } = await shopContext(createPlatformDb(d1), shopId);
    const plan = o.planId ? await createPlatformDb(d1).washPlan.findUnique({ where: { id: o.planId }, select: { shopUse: true } }) : null;
    if (plan?.shopUse === false) return { ok: false, message: 'This plan is used at its community only, not at the shop.' };
    const problem = shopWashProblem(o, rules, today, true);
    if (problem) return { ok: false, message: problem };
    try {
      // One batch: the visit only if a wash is left, and the wash used only if the visit went in.
      await runStatements(d1, [
        {
          sql: `INSERT INTO place_visits (id, shop_id, place_id, order_id, member_vehicle_id, date, outcome, by_user_id, note, job_id)
                SELECT ?, ?, ?, ?, ?, ?, 'done', ?, 'At the shop', ?
                WHERE EXISTS (SELECT 1 FROM place_orders WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total)`,
          params: [newId(), shopId, o.member.placeId, o.id, o.memberVehicle.id, today, input.byUserId, input.jobId, shopId, o.id],
        },
        {
          sql: `UPDATE place_orders SET washes_used = washes_used + 1,
                  status = CASE WHEN washes_used + 1 >= washes_total THEN 'ended' ELSE status END,
                  ended_at = CASE WHEN washes_used + 1 >= washes_total THEN ? ELSE ended_at END,
                  updated_at = ${SQL_NOW}
                WHERE shop_id = ? AND id = ? AND status = 'active' AND washes_used < washes_total
                  AND EXISTS (SELECT 1 FROM place_visits WHERE shop_id = ? AND job_id = ?)`,
          params: [input.now.toISOString(), shopId, o.id, shopId, input.jobId],
        },
      ]);
    } catch (e) {
      if (isUniqueClash(e)) return { ok: false, message: 'This plan was already used today.' };
      throw e;
    }
    const used = await db.placeVisit.findFirst({ where: { jobId: input.jobId }, select: { id: true } });
    return used ? { ok: true } : { ok: false, message: 'Every wash on this plan is used.' };
  },

  /** Gives back the plan wash a voided shop wash used. Safe to repeat. */
  async releaseShopWash(d1: D1Database, shopId: string, jobId: string) {
    const visit = await createShopDb(d1, shopId).placeVisit.findFirst({ where: { jobId }, select: { id: true, orderId: true } });
    if (!visit) return;
    await runStatements(d1, [
      {
        sql: `UPDATE place_orders SET washes_used = washes_used - 1,
                status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
                ended_at = CASE WHEN status = 'ended' THEN NULL ELSE ended_at END,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND washes_used > 0 AND status IN ('active', 'ended')
                AND EXISTS (SELECT 1 FROM place_visits WHERE shop_id = ? AND id = ?)`,
        params: [shopId, visit.orderId, shopId, visit.id],
      },
      { sql: 'DELETE FROM place_visits WHERE shop_id = ? AND id = ?', params: [shopId, visit.id] },
    ]);
  },

  /** The after photo for a wash; returns the photo it replaced, for the caller to delete. */
  async setVisitPhoto(d1: D1Database, shopId: string, placeId: string, visitId: string, photoKey: string): Promise<string | null> {
    const visit = await createShopDb(d1, shopId).placeVisit.findFirst({
      where: { id: visitId, placeId, byCustomer: false },
      select: { photoKey: true },
    });
    if (!visit) return placeFail('not_found', 'Record not found.');
    await runStatements(d1, [{ sql: 'UPDATE place_visits SET photo_key = ? WHERE shop_id = ? AND id = ?', params: [photoKey, shopId, visitId] }]);
    return visit.photoKey;
  },

  async visitPhotoKey(db: DbClient, placeId: string, visitId: string): Promise<string | null> {
    const visit = await db.placeVisit.findFirst({ where: { id: visitId, placeId }, select: { photoKey: true } });
    return visit?.photoKey ?? null;
  },

  /** Takes back a wash-day record made by mistake (recent ones only). */
  async undoVisit(d1: D1Database, shopId: string, placeId: string, visitId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const visit = await db.placeVisit.findFirst({ where: { id: visitId, placeId, byCustomer: false } });
    if (!visit) return placeFail('not_found', 'Record not found.');
    if (dayDiff(visit.date, istDay(now)) > VISIT_BACKDATE_DAYS) return placeFail('not_allowed', 'This record is too old to change.');
    const statements: SqlStatement[] = [{ sql: 'DELETE FROM place_visits WHERE shop_id = ? AND id = ?', params: [shopId, visitId] }];
    if (visit.outcome === 'done') {
      statements.push({
        sql: `UPDATE place_orders SET washes_used = washes_used - 1,
                status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
                ended_at = CASE WHEN status = 'ended' THEN NULL ELSE ended_at END,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND washes_used > 0 AND status IN ('active', 'ended')`,
        params: [shopId, visit.orderId],
      });
    }
    await runStatements(d1, statements);
  },

  // ---------- Nightly (platform-wide) ----------

  /**
   * Orders never paid: the first wash moves to the next wash day the customer can still pay
   * for (the parts move with it); after `unpaidCloseDays` the order closes (nothing is owed).
   * Waiting-list orders get a wash day as soon as the place has room.
   */
  async rollForward(d1: D1Database, now: Date) {
    const pdb = createPlatformDb(d1);
    const orders = await pdb.placeOrder.findMany({
      where: { status: { in: ['awaiting_payment', 'waitlist'] } },
      select: {
        id: true,
        shopId: true,
        status: true,
        firstWashOn: true,
        perWeek: true,
        total: true,
        payMode: true,
        months: true,
        createdAt: true,
        member: { select: { status: true, place: { select: { id: true, washDays: true, capacity: true, status: true } } } },
      },
    });
    const rulesByShop = new Map<string, WashPlanRules>();
    const counters = new Map<string, Awaited<ReturnType<typeof loadCounter>>>();
    const statements: SqlStatement[] = [];
    let moved = 0;
    let closed = 0;
    let promoted = 0;
    for (const o of orders) {
      if (!rulesByShop.has(o.shopId)) rulesByShop.set(o.shopId, (await shopContext(pdb, o.shopId)).rules);
      const rules = rulesByShop.get(o.shopId)!;
      const ageDays = (now.getTime() - o.createdAt.getTime()) / 86_400_000;
      if (ageDays > rules.unpaidCloseDays || o.member.place.status === 'closed' || !['pending', 'active'].includes(o.member.status)) {
        statements.push(
          {
            sql: `UPDATE place_orders SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = 'not_paid',
                    updated_at = ${SQL_NOW}
                  WHERE shop_id = ? AND id = ? AND status IN ('awaiting_payment', 'waitlist')`,
            params: [now.toISOString(), o.shopId, o.id],
          },
          { sql: `UPDATE order_installments SET status = 'cancelled' WHERE shop_id = ? AND order_id = ? AND status = 'due'`, params: [o.shopId, o.id] },
          { sql: `UPDATE customer_payments SET status = 'expired' WHERE shop_id = ? AND order_id = ? AND status = 'created'`, params: [o.shopId, o.id] },
        );
        closed++;
        continue;
      }
      const placeKey = `${o.shopId}:${o.member.place.id}`;
      if (!counters.has(placeKey)) counters.set(placeKey, await loadCounter(createShopDb(d1, o.shopId), o.member.place));
      const counter = counters.get(placeKey)!;
      if (o.status === 'waitlist') {
        const day = counter.pick(o.perWeek, now, rules);
        if (!day) continue;
        statements.push(
          {
            sql: `UPDATE place_orders SET status = 'awaiting_payment', first_wash_on = ?, updated_at = ${SQL_NOW}
                  WHERE shop_id = ? AND id = ? AND status = 'waitlist'`,
            params: [day, o.shopId, o.id],
          },
          ...installmentRows(o.shopId, o.id, { total: o.total, payMode: o.payMode as PayMode, months: o.months }, day, rules),
        );
        promoted++;
        continue;
      }
      if (!o.firstWashOn || payDeadline(o.firstWashOn, rules).getTime() > now.getTime()) continue;
      const day = counter.pick(o.perWeek, now, rules, o.firstWashOn);
      if (!day) continue;
      statements.push(
        {
          sql: `UPDATE place_orders SET first_wash_on = ?, updated_at = ${SQL_NOW} WHERE shop_id = ? AND id = ? AND status = 'awaiting_payment'`,
          params: [day, o.shopId, o.id],
        },
        {
          sql: `UPDATE order_installments SET due_on = date(due_on, ?) WHERE shop_id = ? AND order_id = ? AND status = 'due'`,
          params: [`+${dayDiff(o.firstWashOn, day)} days`, o.shopId, o.id],
        },
      );
      moved++;
    }
    await runStatements(d1, statements);
    return { moved, closed, promoted };
  },
};
