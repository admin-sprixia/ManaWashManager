import {
  addDaysTo,
  dayDiff,
  inRange,
  isClockTime,
  istDay,
  istInstant,
  isSlotDay,
  type DayRange,
} from './places';

/**
 * Wash plans (monthly, quarterly, yearly) and one-time washes for members of a place: prices,
 * paying in full or in parts, the payment deadline before the first wash, skips, pauses, refunds,
 * plan endings, GST and receipt numbers. All money is in paise. Payments are online only
 * (Razorpay); nobody collects cash for these.
 */

export const WASH_PLAN_NAME_MAX = 40;
export const WASH_PLAN_MAX_WASHES = 400;
export const WASH_PLAN_MAX_MONTHS = 24;
export const WASH_PLAN_MAX_DISCOUNT_BP = 9000;
/** Vehicles one customer can add in a single join. */
export const MAX_VEHICLES_PER_JOIN = 6;
/** Extras on one one-time wash. */
export const MAX_EXTRAS = 6;

export type OrderKind = 'plan' | 'single';
export type PayMode = 'full' | 'parts';
export type OrderStatus = 'waitlist' | 'awaiting_payment' | 'active' | 'ended' | 'cancelled';
export type InstallmentStatus = 'due' | 'paid' | 'cancelled';
export type VisitOutcome = 'done' | 'skipped' | 'not_found' | 'missed';
export const VISIT_OUTCOMES: readonly VisitOutcome[] = ['done', 'skipped', 'not_found', 'missed'];

// ─── Rules (business settings) ───────────────────────────────────────────────

export type RefundRule = 'single_price' | 'pro_rata';
export type PlacePriceMode = 'doorstep' | 'hub';

export interface WashPlanRules {
  /** Pay in parts: the first part, as a percent of the plan. */
  partsFirstPct: number;
  /** Pay in parts: how many equal parts follow the first. */
  partsCount: number;
  /** Days a part may be late before washes pause. */
  graceDays: number;
  /** The first payment is due by this time ("HH:MM" IST) the evening before the first wash. */
  payDeadlineTime: string;
  /** Joining within this distance of the place's pin counts as "at the place". */
  atPlaceMeters: number;
  /** A wash can be skipped until this time the evening before. */
  skipCutoffTime: string;
  /** Skips allowed per month of a plan. */
  skipsPerMonth: number;
  /** Pause days allowed per month of a plan. */
  pauseDaysPerMonth: number;
  refundRule: RefundRule;
  /** Reminder this many days before a plan's last wash. */
  renewalReminderDays: number;
  /** An order never paid is closed after this many days (nothing is owed). */
  unpaidCloseDays: number;
  /** Which branch price a place wash is charged at. */
  priceMode: PlacePriceMode;
  /**
   * Washing one customer's vehicle at their home. Off: the shop and communities only — the
   * doorstep choice is hidden everywhere (the team that goes to communities stays).
   */
  homeWash: boolean;
  /** GST included in every price, in basis points (1800 = 18%). */
  gstRateBp: number;
  gstin: string | null;
  legalName: string | null;
}

export const DEFAULT_WASH_PLAN_RULES: WashPlanRules = {
  partsFirstPct: 20,
  partsCount: 4,
  graceDays: 3,
  payDeadlineTime: '20:00',
  atPlaceMeters: 200,
  skipCutoffTime: '20:00',
  skipsPerMonth: 1,
  pauseDaysPerMonth: 7,
  refundRule: 'single_price',
  renewalReminderDays: 7,
  unpaidCloseDays: 28,
  priceMode: 'doorstep',
  homeWash: false,
  gstRateBp: 1800,
  gstin: null,
  legalName: null,
};

/** Each rule's business_settings key. */
export const WASH_PLAN_RULE_KEYS: Readonly<Record<keyof WashPlanRules, string>> = {
  partsFirstPct: 'places.partsFirstPct',
  partsCount: 'places.partsCount',
  graceDays: 'places.graceDays',
  payDeadlineTime: 'places.payDeadlineTime',
  atPlaceMeters: 'places.atPlaceMeters',
  skipCutoffTime: 'places.skipCutoffTime',
  skipsPerMonth: 'places.skipsPerMonth',
  pauseDaysPerMonth: 'places.pauseDaysPerMonth',
  refundRule: 'places.refundRule',
  renewalReminderDays: 'places.renewalReminderDays',
  unpaidCloseDays: 'places.unpaidCloseDays',
  priceMode: 'places.priceMode',
  homeWash: 'branch.homeWash',
  gstRateBp: 'places.gstRateBp',
  gstin: 'places.gstin',
  legalName: 'places.legalName',
};

/** Allowed range of each number rule (also what the admin screen checks). */
export const WASH_PLAN_RULE_LIMITS = {
  partsFirstPct: [5, 90],
  partsCount: [1, 12],
  graceDays: [0, 30],
  atPlaceMeters: [50, 2000],
  skipsPerMonth: [0, 8],
  pauseDaysPerMonth: [0, 31],
  renewalReminderDays: [1, 30],
  unpaidCloseDays: [7, 120],
  gstRateBp: [0, 2800],
} as const satisfies Partial<Record<keyof WashPlanRules, readonly [number, number]>>;

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function intIn(raw: string | null | undefined, [min, max]: readonly [number, number], fallback: number): number {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Stored settings → rules; anything missing or broken falls back to the default. */
export function parseWashPlanRules(raw: Partial<Record<keyof WashPlanRules, string | null | undefined>>): WashPlanRules {
  const d = DEFAULT_WASH_PLAN_RULES;
  const L = WASH_PLAN_RULE_LIMITS;
  const time = (v: string | null | undefined, fallback: string) => (v && isClockTime(v) ? v : fallback);
  const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    partsFirstPct: intIn(raw.partsFirstPct, L.partsFirstPct, d.partsFirstPct),
    partsCount: intIn(raw.partsCount, L.partsCount, d.partsCount),
    graceDays: intIn(raw.graceDays, L.graceDays, d.graceDays),
    payDeadlineTime: time(raw.payDeadlineTime, d.payDeadlineTime),
    atPlaceMeters: intIn(raw.atPlaceMeters, L.atPlaceMeters, d.atPlaceMeters),
    skipCutoffTime: time(raw.skipCutoffTime, d.skipCutoffTime),
    skipsPerMonth: intIn(raw.skipsPerMonth, L.skipsPerMonth, d.skipsPerMonth),
    pauseDaysPerMonth: intIn(raw.pauseDaysPerMonth, L.pauseDaysPerMonth, d.pauseDaysPerMonth),
    refundRule: raw.refundRule === 'pro_rata' ? 'pro_rata' : 'single_price',
    renewalReminderDays: intIn(raw.renewalReminderDays, L.renewalReminderDays, d.renewalReminderDays),
    unpaidCloseDays: intIn(raw.unpaidCloseDays, L.unpaidCloseDays, d.unpaidCloseDays),
    priceMode: raw.priceMode === 'hub' ? 'hub' : 'doorstep',
    homeWash: raw.homeWash === 'true',
    gstRateBp: intIn(raw.gstRateBp, L.gstRateBp, d.gstRateBp),
    gstin: text(raw.gstin)?.toUpperCase() ?? null,
    legalName: text(raw.legalName),
  };
}

/** Rules → the strings stored in business_settings (null = remove the setting). */
export function serializeWashPlanRules(patch: Partial<WashPlanRules>): [string, string | null][] {
  return (Object.keys(patch) as (keyof WashPlanRules)[]).map((k) => {
    const v = patch[k];
    return [WASH_PLAN_RULE_KEYS[k], v == null || v === '' ? null : String(v)];
  });
}

// ─── Prices ──────────────────────────────────────────────────────────────────

/** Plan prices land on whole rupees. */
export const roundRupee = (paise: number) => Math.round(paise / 100) * 100;

/** A plan's price: the per-wash price × washes, less the plan's discount. */
export function washPlanPrice(perWash: number, washes: number, discountBp: number): number {
  return roundRupee((perWash * washes * (10000 - discountBp)) / 10000);
}

/** Washes a vehicle gets each week on a plan (a monthly plan of 4 → 1). */
export function washesPerWeek(washes: number, months: number): number {
  return Math.min(7, Math.max(1, Math.round((washes * 12) / (months * 52))));
}

/** A one-time wash takes the place's next wash day, whichever weekday it is. */
export const SINGLE_PER_WEEK = 7;

// ─── Paying ──────────────────────────────────────────────────────────────────

/** The first payment's deadline: the evening before the first wash. */
export function payDeadline(firstWashOn: string, rules: Pick<WashPlanRules, 'payDeadlineTime'>): Date {
  return istInstant(addDaysTo(firstWashOn, -1), rules.payDeadlineTime);
}

/**
 * The first wash for an order made now: the earliest slot day whose payment deadline hasn't
 * passed (so the customer always has time to pay). `after` pushes it later (a plan renewed
 * before the current one ends, or a full place).
 */
export function firstWashDay(input: {
  washDays: readonly number[];
  perWeek: number;
  now: Date;
  rules: Pick<WashPlanRules, 'payDeadlineTime'>;
  after?: string | null;
}): string | null {
  if (!input.washDays.length) return null;
  let day = addDaysTo(istDay(input.now), 1);
  if (input.after && input.after >= day) day = addDaysTo(input.after, 1);
  for (let n = 0; n < 60; n++, day = addDaysTo(day, 1)) {
    if (!isSlotDay(input.washDays, input.perWeek, day)) continue;
    if (payDeadline(day, input.rules).getTime() > input.now.getTime()) return day;
  }
  return null;
}

export interface InstallmentPlanned {
  seq: number;
  amount: number;
  dueOn: string;
}

/**
 * What is paid when. In full: everything before the first wash. In parts: the first part before
 * the first wash, then equal parts spread evenly over the plan (whole rupees; the last part
 * absorbs the rounding).
 */
export function installmentPlan(input: {
  total: number;
  mode: PayMode;
  firstDueOn: string;
  months: number;
  rules: Pick<WashPlanRules, 'partsFirstPct' | 'partsCount'>;
}): InstallmentPlanned[] {
  const { total, firstDueOn } = input;
  if (input.mode === 'full' || total <= 0) return [{ seq: 1, amount: total, dueOn: firstDueOn }];
  const parts = input.rules.partsCount;
  const first = roundRupee((total * input.rules.partsFirstPct) / 100);
  const each = roundRupee((total - first) / parts);
  const span = Math.round(input.months * 30.4375);
  const out: InstallmentPlanned[] = [{ seq: 1, amount: first, dueOn: firstDueOn }];
  for (let i = 1; i <= parts; i++) {
    const amount = i === parts ? total - first - each * (parts - 1) : each;
    out.push({ seq: i + 1, amount, dueOn: addDaysTo(firstDueOn, Math.round((i * span) / (parts + 1))) });
  }
  return out;
}

export interface InstallmentState {
  seq: number;
  amount: number;
  dueOn: string;
  status: InstallmentStatus;
}

export function nextDue<T extends InstallmentState>(installments: readonly T[]): T | null {
  return [...installments].filter((i) => i.status === 'due').sort((a, b) => a.seq - b.seq)[0] ?? null;
}

export const paidTotal = (installments: readonly InstallmentState[]) =>
  installments.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);

// ─── Where an order stands ───────────────────────────────────────────────────

/**
 * - waitlist: the place is full that day; no payment asked yet
 * - awaiting_payment: joined, first payment not made (no washes)
 * - active: washing
 * - payment_due: a part is due or a little late (still washing, inside the grace days)
 * - paused_unpaid: a part is later than the grace days: washes stop until it's paid
 * - on_pause: the customer paused (holiday)
 * - ended / cancelled
 */
export type OrderPhase =
  | 'waitlist'
  | 'awaiting_payment'
  | 'active'
  | 'payment_due'
  | 'paused_unpaid'
  | 'on_pause'
  | 'ended'
  | 'cancelled';

export function orderPhase(input: {
  status: OrderStatus;
  installments: readonly InstallmentState[];
  pauses: readonly DayRange[];
  today: string;
  graceDays: number;
}): OrderPhase {
  if (input.status !== 'active') return input.status;
  const due = nextDue(input.installments);
  if (due && dayDiff(due.dueOn, input.today) > input.graceDays) return 'paused_unpaid';
  if (input.pauses.some((p) => inRange(input.today, p))) return 'on_pause';
  if (due && due.dueOn <= input.today) return 'payment_due';
  return 'active';
}

/** Washes are given only in these phases. */
export const isWashing = (phase: OrderPhase) => phase === 'active' || phase === 'payment_due' || phase === 'on_pause';

/** Time to offer renewal: the last wash is close. */
export function renewalDue(lastWash: string | null, today: string, rules: Pick<WashPlanRules, 'renewalReminderDays'>): boolean {
  return lastWash != null && dayDiff(today, lastWash) <= rules.renewalReminderDays;
}

// ─── Skips and pauses ────────────────────────────────────────────────────────

export const skipsAllowed = (months: number, rules: Pick<WashPlanRules, 'skipsPerMonth'>) => months * rules.skipsPerMonth;
export const pauseDaysAllowed = (months: number, rules: Pick<WashPlanRules, 'pauseDaysPerMonth'>) =>
  months * rules.pauseDaysPerMonth;

/** Changes to a day (skip it, start a pause on it) are allowed until the cut-off the evening before. */
export function beforeCutoff(day: string, now: Date, rules: Pick<WashPlanRules, 'skipCutoffTime'>): boolean {
  return now.getTime() < istInstant(addDaysTo(day, -1), rules.skipCutoffTime).getTime();
}

export const rangeDays = (r: DayRange) => dayDiff(r.fromOn, r.toOn) + 1;

// ─── Cancelling ──────────────────────────────────────────────────────────────

/**
 * What a cancel costs. Before any wash: everything back. After: the washes given are charged at
 * the one-time price (or their share of the plan, pro rata) and the rest is refunded.
 */
export function cancelRefund(input: {
  paid: number;
  total: number;
  washesTotal: number;
  washesUsed: number;
  singlePrice: number;
  rule: RefundRule;
}): { charged: number; refund: number } {
  const used = Math.max(0, input.washesUsed);
  const owed =
    input.rule === 'pro_rata'
      ? Math.round((input.total * used) / Math.max(1, input.washesTotal))
      : used * input.singlePrice;
  const charged = Math.min(input.paid, owed);
  return { charged, refund: Math.max(0, input.paid - charged) };
}

// ─── Receipts ────────────────────────────────────────────────────────────────

/** "₹21,600" / "₹1,25,000.50": Indian digit grouping, paise only when there are any. */
export function formatInr(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const cents = abs % 100;
  return `${sign}₹${rest ? `${rest},` : ''}${last3}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

/** GST inside a price that already includes it, split equally into CGST and SGST. */
export function gstBreakup(amount: number, rateBp: number): { taxable: number; cgst: number; sgst: number; rateBp: number } {
  const taxable = Math.round((amount * 10000) / (10000 + rateBp));
  const tax = amount - taxable;
  const cgst = Math.floor(tax / 2);
  return { taxable, cgst, sgst: tax - cgst, rateBp };
}

/** India's financial year (April–March) a day is in: "26-27". */
export function financialYear(day: string): string {
  const year = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "MW-KVR-01/26-27/00042". */
export function formatReceiptNumber(prefix: string, fy: string, n: number): string {
  return `${prefix}/${fy}/${String(n).padStart(5, '0')}`;
}
