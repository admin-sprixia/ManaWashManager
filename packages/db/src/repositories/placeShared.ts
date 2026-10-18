import {
  beforeCutoff,
  firstWashDay,
  isUpgradeWash,
  isWashing,
  istDay,
  orderPhase,
  parseWashDays,
  parseWashPlanRules,
  pauseDaysAllowed,
  payDeadline,
  predictedLastWash,
  rangeDays,
  renewalDue,
  skipsAllowed,
  upcomingWashes,
  WASH_PLAN_RULE_KEYS,
  type DayRange,
  type InstallmentStatus,
  type OrderKind,
  type OrderPhase,
  type OrderStatus,
  type PayMode,
  type PlanUpgrade,
  type ScheduleInput,
  type WashPlanRules,
} from '@mana/domain';
import type { DbClient } from '../client';

/**
 * What the places, plans and payments repositories share: their error type, the business rules a
 * branch runs under, and where an order stands (its phase, next washes, what is due).
 */

export type PlaceErrorCode = 'not_found' | 'invalid' | 'conflict' | 'not_allowed' | 'busy';

export class PlaceError extends Error {
  constructor(
    readonly code: PlaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlaceError';
  }
}

export const placeFail = (code: PlaceErrorCode, message: string): never => {
  throw new PlaceError(code, message);
};

/** The plan rules a business set (defaults for anything it didn't). Platform client. */
export async function businessRules(pdb: DbClient, businessId: string | null): Promise<WashPlanRules> {
  if (!businessId) return parseWashPlanRules({});
  const rows = await pdb.businessSetting.findMany({
    where: { businessId, key: { in: Object.values(WASH_PLAN_RULE_KEYS) } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return parseWashPlanRules(
    Object.fromEntries(Object.entries(WASH_PLAN_RULE_KEYS).map(([field, key]) => [field, byKey.get(key)])),
  );
}

/** A branch, its business and the rules it runs under. Platform client. */
export async function shopContext(pdb: DbClient, shopId: string) {
  const shop = await pdb.shop.findUnique({
    where: { id: shopId },
    select: { id: true, code: true, name: true, city: true, businessId: true, contactPhone: true, inCustomerApp: true },
  });
  if (!shop) return placeFail('not_found', 'Branch not found.');
  return { shop, rules: await businessRules(pdb, shop.businessId) };
}

export type ShopContext = Awaited<ReturnType<typeof shopContext>>;

/** What a plan order was sold as (its snapshot): the plan's wash and its upgraded wash. */
export interface SoldPlan {
  serviceName: string | null;
  upgrade: (PlanUpgrade & { catalogServiceId: string | null }) | null;
}

export function soldPlan(snapshot: string): SoldPlan {
  try {
    const value = JSON.parse(snapshot) as {
      items?: { name?: unknown }[];
      plan?: { upgrade?: { every?: unknown; name?: unknown; catalogServiceId?: unknown } | null } | null;
    };
    const up = value?.plan?.upgrade;
    const first = value?.items?.[0]?.name;
    return {
      serviceName: typeof first === 'string' ? first : null,
      upgrade:
        up && typeof up.every === 'number' && typeof up.name === 'string'
          ? { every: up.every, name: up.name, catalogServiceId: typeof up.catalogServiceId === 'string' ? up.catalogServiceId : null }
          : null,
    };
  } catch {
    return { serviceName: null, upgrade: null };
  }
}

/**
 * Which wash wash number `washNo` of a plan order is: null for plans where every wash is the
 * same, else its name and whether it's the upgraded one ("Wash 4 of 4: Premium").
 */
export function planWashOf(snapshot: string, washNo: number): { name: string; upgraded: boolean } | null {
  const sold = soldPlan(snapshot);
  if (!sold.upgrade) return null;
  const upgraded = isUpgradeWash(washNo, sold.upgrade);
  return { name: upgraded ? sold.upgrade.name : (sold.serviceName ?? 'Regular wash'), upgraded };
}

// ─── Where an order stands ───────────────────────────────────────────────────

/** The order fields (and children) every summary needs. */
export const orderStateSelect = {
  id: true,
  kind: true,
  title: true,
  status: true,
  washesTotal: true,
  washesUsed: true,
  months: true,
  perWeek: true,
  total: true,
  singlePrice: true,
  payMode: true,
  firstWashOn: true,
  renewalOf: true,
  refundDue: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  installments: {
    select: { id: true, seq: true, amount: true, dueOn: true, status: true, paidAt: true },
    orderBy: { seq: 'asc' as const },
  },
  pauses: { where: { cancelledAt: null }, select: { id: true, fromOn: true, toOn: true }, orderBy: { fromOn: 'asc' as const } },
  visits: { select: { date: true, outcome: true, byCustomer: true } },
} as const;

export interface OrderStateRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  washesTotal: number;
  washesUsed: number;
  months: number;
  perWeek: number;
  total: number;
  singlePrice: number;
  payMode: string;
  firstWashOn: string | null;
  renewalOf: string | null;
  refundDue: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  installments: { id: string; seq: number; amount: number; dueOn: string; status: string; paidAt: Date | null }[];
  pauses: { id: string; fromOn: string; toOn: string }[];
  visits: { date: string; outcome: string; byCustomer: boolean }[];
}

/** The washes still to give, as the schedule functions take them. */
export function scheduleOf(order: OrderStateRow, washDays: readonly number[], today: string): ScheduleInput {
  return {
    washDays,
    perWeek: order.perWeek,
    startsOn: order.firstWashOn ?? today,
    remaining: Math.max(0, order.washesTotal - order.washesUsed),
    taken: new Set(order.visits.map((v) => v.date)),
    pauses: order.pauses as DayRange[],
  };
}

export function phaseOf(order: OrderStateRow, rules: Pick<WashPlanRules, 'graceDays'>, today: string): OrderPhase {
  return orderPhase({
    status: order.status as OrderStatus,
    installments: order.installments.map((i) => ({ ...i, status: i.status as InstallmentStatus })),
    pauses: order.pauses,
    today,
    graceDays: rules.graceDays,
  });
}

/**
 * An unpaid order's first wash once its pay-by time has passed is the next day the customer can
 * still pay for. The nightly roll-forward saves this; until then it is worked out on the fly.
 */
export function payableFirstWash(
  order: { status: string; firstWashOn: string | null; perWeek: number },
  washDays: readonly number[],
  rules: WashPlanRules,
  now: Date,
): string | null {
  const first = order.firstWashOn;
  if (order.status !== 'awaiting_payment' || !first || payDeadline(first, rules).getTime() > now.getTime()) return first;
  return firstWashDay({ washDays, perWeek: order.perWeek, now, rules }) ?? first;
}

/** Everything the apps show about one order: where it stands, what's next, what's due. */
export function orderSummary(order: OrderStateRow, washDaysText: string, rules: WashPlanRules, now: Date) {
  const today = istDay(now);
  const washDays = parseWashDays(washDaysText);
  const phase = phaseOf(order, rules, today);
  const schedule = scheduleOf(order, washDays, today);
  const running = order.status === 'active';
  const firstWashOn = payableFirstWash(order, washDays, rules, now);
  const upcoming =
    order.status === 'awaiting_payment'
      ? firstWashOn
        ? [firstWashOn]
        : []
      : running
        ? upcomingWashes(schedule, today, 4)
        : [];
  const lastWash = running ? predictedLastWash(schedule, today) : null;
  const due = order.installments.filter((i) => i.status === 'due').sort((a, b) => a.seq - b.seq)[0] ?? null;
  const skipsUsed = order.visits.filter((v) => v.outcome === 'skipped' && v.byCustomer).length;
  const pauseDaysUsed = order.pauses.reduce((n, p) => n + rangeDays(p), 0);
  const paid = order.installments.filter((i) => i.status === 'paid').reduce((n, i) => n + i.amount, 0);
  const skipped = order.visits.filter((v) => v.outcome === 'skipped' && v.byCustomer).map((v) => v.date).filter((d) => d >= today).sort();
  return {
    id: order.id,
    kind: order.kind as OrderKind,
    title: order.title,
    status: order.status as OrderStatus,
    phase,
    /** Washes are given (the washer sees "Paid"). */
    washing: isWashing(phase),
    washesTotal: order.washesTotal,
    washesUsed: order.washesUsed,
    washesLeft: Math.max(0, order.washesTotal - order.washesUsed),
    months: order.months,
    perWeek: order.perWeek,
    total: order.total,
    paid,
    payMode: order.payMode as PayMode,
    firstWashOn,
    nextWashes: upcoming,
    lastWash,
    due: due ? { installmentId: due.id, seq: due.seq, amount: due.amount, dueOn: due.dueOn } : null,
    installments: order.installments.map((i) => ({
      seq: i.seq,
      amount: i.amount,
      dueOn: i.dueOn,
      status: i.status as InstallmentStatus,
      paidAt: i.paidAt?.toISOString() ?? null,
    })),
    skipped,
    /** Upcoming or skipped days past the skip cutoff: they can no longer be skipped or undone. */
    skipClosed: [...new Set([...upcoming, ...skipped])].filter((d) => !beforeCutoff(d, now, rules)).sort(),
    skipsLeft: order.kind === 'plan' ? Math.max(0, skipsAllowed(order.months, rules) - skipsUsed) : 0,
    pauses: order.pauses.filter((p) => p.toOn >= today).map((p) => ({ id: p.id, fromOn: p.fromOn, toOn: p.toOn })),
    pauseDaysLeft: order.kind === 'plan' ? Math.max(0, pauseDaysAllowed(order.months, rules) - pauseDaysUsed) : 0,
    renewalDue: order.kind === 'plan' && running && renewalDue(lastWash, today, rules),
    refundDue: order.refundDue,
    cancelReason: order.cancelReason,
    renewalOf: order.renewalOf,
    createdAt: order.createdAt.toISOString(),
  };
}

export type OrderSummary = ReturnType<typeof orderSummary>;
