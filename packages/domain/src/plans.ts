/**
 * Plans: every shop is on Free or Pro. A new shop gets Pro free for SHOP_TRIAL_DAYS, then stays
 * Pro while its subscription is paid, and falls back to Free otherwise. Nothing is ever deleted
 * on Free — features and extra staff are locked until the shop upgrades again.
 *
 * Which tier a shop is on is worked out from dates (trial end, paid until), not from a stored
 * flag, so it changes on time even if a webhook or the nightly job is late.
 */

export type PlanTier = 'free' | 'pro';

/** What the owner sees: on the trial, paid Pro, Pro while a failed payment is retried, or Free. */
export type PlanState = 'trial' | 'pro' | 'grace' | 'free';

/** The subscription's own status, stored on the shop (`shops.plan`) from Razorpay's webhooks. */
export type SubscriptionStatus = 'trial' | 'pending' | 'active' | 'past_due' | 'cancelled' | 'free';

export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'];

/** Prices in paise. Yearly is about ten months' price — two months free. */
export const PRO_PRICE_PAISE: Record<BillingInterval, number> = { monthly: 49_900, yearly: 499_900 };
/**
 * The first FOUNDER_SLOTS shops to pay keep this price for life — every renewal, monthly or
 * yearly, even after cancelling and coming back. Shop 51 onwards gets the regular price.
 */
export const FOUNDER_PRICE_PAISE: Record<BillingInterval, number> = { monthly: 39_900, yearly: 399_000 };
export const FOUNDER_SLOTS = 50;
/**
 * A shop pays this while another shop of the same owner is on paid Pro. Decided when the branch
 * subscribes and kept for that subscription; subscribing again re-checks it. Kept below the
 * founder price so a second shop is always the cheapest way to grow.
 */
export const BRANCH_PRICE_PAISE: Record<BillingInterval, number> = { monthly: 34_900, yearly: 349_000 };

/**
 * A founder slot is held for a shop from checkout until its first charge, so slots can't be
 * oversold while payments are pending: for this long while the checkout link is open, then, once
 * AutoPay is approved, until FOUNDER_HOLD_RETRY_DAYS after the first charge is due (covering
 * Razorpay's retries of a failed first charge). It lapses if the shop never pays.
 */
export const FOUNDER_HOLD_CHECKOUT_HOURS = 48;
export const FOUNDER_HOLD_RETRY_DAYS = 7;

/** A shop that has, or is holding, a founder slot. */
export interface FounderClaim {
  id: string;
  founderAt: Date | null;
  holdUntil: Date | null;
  holdAt: Date | null;
}

/**
 * Slots taken ahead of `me`, who has just stamped a hold: every paid founder, plus live holds
 * stamped earlier (same instant: lower shop id first). Each racer counts only those ahead of it,
 * so when several grab the last slot at once exactly one sees fewer than FOUNDER_SLOTS — never
 * two (oversold) and never none (lost).
 */
export function founderSlotsAhead(claims: readonly FounderClaim[], me: { id: string; holdAt: Date }, now: Date): number {
  const mine = me.holdAt.getTime();
  return claims.filter((c) => {
    if (c.id === me.id) return false;
    if (c.founderAt) return true;
    if (!c.holdUntil || c.holdUntil.getTime() <= now.getTime()) return false;
    if (!c.holdAt) return true;
    const theirs = c.holdAt.getTime();
    return theirs < mine || (theirs === mine && c.id < me.id);
  }).length;
}

/** Which price a shop is offered. */
export type PriceKind = 'regular' | 'founder' | 'branch';

/**
 * On Free, washes entered offline still sync this far past the monthly limit — the car was
 * already washed before the phone could know the month was used up.
 */
export const WASH_LIMIT_OFFLINE_GRACE = 25;

/** A failed renewal keeps Pro this long while Razorpay retries the charge. */
export const PAYMENT_GRACE_DAYS = 3;

export interface PlanLimits {
  /** Active people besides the shop's first owner (a second owner takes one of these). */
  staff: number;
  /** Washes started per IST calendar month; null = unlimited. */
  washesPerMonth: number | null;
  /** How far back reports can look, counting today; null = any range. */
  reportDays: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { staff: 1, washesPerMonth: 300, reportDays: 7 },
  pro: { staff: 5, washesPerMonth: null, reportDays: null },
};

export type ProFeature =
  | 'photos'
  | 'reminders'
  | 'coupons'
  | 'referrals'
  | 'fullReports'
  | 'pdfExport'
  | 'expenses'
  | 'cashDrawer'
  | 'commission'
  | 'attendance'
  | 'inventory'
  | 'staffReport'
  | 'auditTrail'
  | 'branches';

export const PRO_FEATURE_LABEL: Record<ProFeature, string> = {
  photos: 'Before & after photos',
  reminders: 'Customer reminders',
  coupons: 'Comeback coupons',
  referrals: 'Referrals',
  fullReports: 'Reports for any dates',
  pdfExport: 'PDF reports',
  expenses: 'Expenses & net profit',
  cashDrawer: 'Cash drawer',
  commission: 'Staff commission',
  attendance: 'Attendance',
  inventory: 'Inventory',
  staffReport: 'Staff performance',
  auditTrail: 'Audit trail',
  branches: 'More branches',
};

/** Shown on the plan screen, in this order. */
export const PRO_HIGHLIGHTS: readonly ProFeature[] = [
  'cashDrawer',
  'reminders',
  'coupons',
  'referrals',
  'fullReports',
  'pdfExport',
  'expenses',
  'photos',
  'commission',
  'attendance',
  'inventory',
  'branches',
];

/**
 * Paid Pro — what opening another branch needs. A trial doesn't count, so new branches can't be
 * used to keep starting fresh trials; a renewal that's being retried (grace) still does.
 */
export function isPaidPro(status: Pick<PlanStatus, 'state'>): boolean {
  return status.state === 'pro' || status.state === 'grace';
}

/** "₹349 a month" — for messages about the branch price. */
export const BRANCH_PRICE_LABEL = `₹${BRANCH_PRICE_PAISE.monthly / 100} a month`;

export const BRANCH_NEEDS_PAID_PRO = `Opening another branch needs a shop on paid Pro — a free trial doesn’t count. Each extra branch can then go Pro for ${BRANCH_PRICE_LABEL}.`;

export interface PlanShop {
  plan: string;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
}

export interface PlanStatus {
  tier: PlanTier;
  state: PlanState;
  limits: PlanLimits;
  /** When the current Pro period (trial, paid or grace) ends; null on Free. */
  endsAt: Date | null;
  /** Whole days until `endsAt`, rounded up; null on Free. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function proStatus(state: PlanState, endsAt: Date, now: Date): PlanStatus {
  return {
    tier: 'pro',
    state,
    limits: PLAN_LIMITS.pro,
    endsAt,
    daysLeft: Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)),
  };
}

/**
 * A paid period wins over the trial. Grace only follows a subscription that's still trying to
 * charge — a cancelled one simply ends when its paid period does.
 */
export function planStatus(shop: PlanShop, now: Date = new Date()): PlanStatus {
  const t = now.getTime();
  if (shop.paidUntil) {
    const paid = shop.paidUntil.getTime();
    if (t < paid) return proStatus('pro', shop.paidUntil, now);
    const retrying = shop.plan === 'active' || shop.plan === 'past_due';
    const graceEnd = new Date(paid + PAYMENT_GRACE_DAYS * DAY_MS);
    if (retrying && t < graceEnd.getTime()) return proStatus('grace', graceEnd, now);
  }
  if (shop.trialEndsAt && t < shop.trialEndsAt.getTime()) {
    return proStatus('trial', shop.trialEndsAt, now);
  }
  return { tier: 'free', state: 'free', limits: PLAN_LIMITS.free, endsAt: null, daysLeft: null };
}

const PRICE_PAISE: Record<PriceKind, Record<BillingInterval, number>> = {
  regular: PRO_PRICE_PAISE,
  founder: FOUNDER_PRICE_PAISE,
  branch: BRANCH_PRICE_PAISE,
};

/** The price a shop pays for an interval. */
export function proPricePaise(interval: BillingInterval, kind: PriceKind): number {
  return PRICE_PAISE[kind][interval];
}

/**
 * The cheapest price the shop qualifies for. `founder` means it already is one (or holds a slot).
 * On a tie the branch price wins over taking a founder slot, so the 50 slots go to new owners.
 */
export function priceKindFor(input: { founder: boolean; founderSlotsLeft: number; branch: boolean }): PriceKind {
  const options: PriceKind[] = ['regular'];
  if (input.branch) options.push('branch');
  if (input.founder || input.founderSlotsLeft > 0) options.push('founder');
  return options.reduce((best, kind) => (PRICE_PAISE[kind].monthly < PRICE_PAISE[best].monthly ? kind : best));
}

/** Error codes the API returns (HTTP 402) when the plan doesn't allow something. */
export type PlanErrorCode = 'plan_required' | 'plan_wash_limit' | 'plan_staff_limit' | 'plan_seat_locked';

export function planRequiredMessage(feature: ProFeature): string {
  return `${PRO_FEATURE_LABEL[feature]} is part of Pro. Upgrade to use it.`;
}

export function washLimitMessage(limit: number): string {
  return `Your Free plan includes ${limit} washes a month, and this month’s are used up. Upgrade to Pro for unlimited washes.`;
}

export function staffLimitMessage(tier: PlanTier, limit: number): string {
  return tier === 'free'
    ? `The Free plan includes the owner and ${limit} more person. Upgrade to Pro for up to ${PLAN_LIMITS.pro.staff} staff.`
    : `Pro includes the owner and up to ${limit} more people. Remove or switch someone off to add another.`;
}

export const SEAT_LOCKED_MESSAGE =
  'Your shop is on the Free plan, which includes the owner and 1 staff member. Ask the owner to upgrade to Pro so you can sign in.';
