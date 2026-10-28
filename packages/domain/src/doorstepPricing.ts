/**
 * Prices away from the shop. Three ways a car is washed, three ways to price it:
 *
 *   Hub        the base price: the customer comes to the shop. The lowest of the three.
 *   Community  the hub price plus head office's community markup (10% by default, ending in 9),
 *              less a neighbours discount that grows with the share of the community's flats that
 *              wash with us; never below the hub price, whatever the discount.
 *   Doorstep   the hub price plus one visit charge per visit to a home: a visit fee, then a charge
 *              per km beyond the free distance from the branch, up to the furthest the team goes,
 *              plus any busy-time extra. Two cars at one home share the visit charge.
 *
 * So a wash always costs Hub ≤ Community ≤ Doorstep: going out costs the team travel and time.
 */

/** A busy-time extra on doorstep visits: on these days (0 = Sunday), between these times. */
export interface BusyExtra {
  days: number[];
  /** "HH:MM", 24-hour, IST. */
  from: string;
  to: string;
  extraPaise: number;
}

export interface DoorstepVisitRules {
  /** Paid once per visit: setting up, water, the kit. */
  visitFeePaise: number;
  /** No distance charge within this many km of the branch. */
  freeKm: number;
  /** For every km (or part of one) beyond the free distance. */
  perKmPaise: number;
  /** The team doesn't go further than this. */
  maxKm: number;
  /** Round the visit charge up to a price ending in 9 (₹98 → ₹99). */
  roundTo9: boolean;
  busy: BusyExtra[];
}

export const DEFAULT_DOORSTEP_RULES: DoorstepVisitRules = {
  visitFeePaise: 9900,
  freeKm: 3,
  perKmPaise: 1000,
  maxKm: 15,
  roundTo9: true,
  busy: [],
};

/** Roads wind: a straight line on the map times this is about the distance driven. */
export const ROAD_FACTOR = 1.3;
export const DOORSTEP_LIMITS = {
  visitFeeMaxPaise: 200_000,
  perKmMaxPaise: 20_000,
  freeKmMax: 50,
  maxKmMax: 100,
  busyMax: 10,
} as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Why these rules can't be saved, or null when they can. */
export function doorstepRulesProblem(r: DoorstepVisitRules): string | null {
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (!whole(r.visitFeePaise) || r.visitFeePaise > DOORSTEP_LIMITS.visitFeeMaxPaise) return 'The visit fee looks wrong.';
  if (!whole(r.perKmPaise) || r.perKmPaise > DOORSTEP_LIMITS.perKmMaxPaise) return 'The charge per km looks wrong.';
  if (!(r.freeKm >= 0 && r.freeKm <= DOORSTEP_LIMITS.freeKmMax)) return `Free distance is 0 to ${DOORSTEP_LIMITS.freeKmMax} km.`;
  if (!(r.maxKm >= 1 && r.maxKm <= DOORSTEP_LIMITS.maxKmMax)) return `The furthest distance is 1 to ${DOORSTEP_LIMITS.maxKmMax} km.`;
  if (r.maxKm < r.freeKm) return 'The furthest distance can’t be less than the free distance.';
  if (r.busy.length > DOORSTEP_LIMITS.busyMax) return `Up to ${DOORSTEP_LIMITS.busyMax} busy-time extras.`;
  for (const b of r.busy) {
    if (!b.days.length || b.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick the days for each busy-time extra.';
    if (!TIME.test(b.from) || !TIME.test(b.to)) return 'Busy times are like 07:00 and 11:00.';
    if (minutesOf(b.to) <= minutesOf(b.from)) return 'A busy time has to end after it starts.';
    if (!whole(b.extraPaise) || b.extraPaise === 0 || b.extraPaise > DOORSTEP_LIMITS.visitFeeMaxPaise) return 'Enter the extra for each busy time.';
  }
  return null;
}

/** Stored rules (JSON) with anything missing or broken falling back to the defaults. */
export function parseDoorstepRules(value: string | null | undefined): DoorstepVisitRules {
  if (!value) return DEFAULT_DOORSTEP_RULES;
  try {
    const raw = JSON.parse(value) as Partial<DoorstepVisitRules>;
    const rules: DoorstepVisitRules = {
      ...DEFAULT_DOORSTEP_RULES,
      ...raw,
      busy: Array.isArray(raw.busy) ? raw.busy : [],
    };
    return doorstepRulesProblem(rules) ? DEFAULT_DOORSTEP_RULES : rules;
  } catch {
    return DEFAULT_DOORSTEP_RULES;
  }
}

/** The road distance for a straight-line distance on the map, to 0.1 km. */
export function roadKm(straightKm: number): number {
  return Math.round(straightKm * ROAD_FACTOR * 10) / 10;
}

/** IST weekday (0 = Sunday) and minutes since midnight. */
function istClock(at: Date): { day: number; minutes: number } {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return { day: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

/** The busy-time extras that apply at this moment. */
export function busyExtrasAt(rules: DoorstepVisitRules, at: Date): BusyExtra[] {
  const { day, minutes } = istClock(at);
  return rules.busy.filter((b) => b.days.includes(day) && minutes >= minutesOf(b.from) && minutes < minutesOf(b.to));
}

/** ₹48 → ₹49, ₹50 → ₹59, ₹99 → ₹99: the next whole-rupee price ending in 9. */
export function roundUpTo9(paise: number): number {
  if (paise <= 0) return 0;
  const rupees = Math.ceil(paise / 100);
  return (Math.ceil((rupees + 1) / 10) * 10 - 1) * 100;
}

export interface VisitCharge {
  /** The distance charged for, to 0.1 km. */
  km: number;
  /** Further than the team goes: no charge, the visit isn't offered. */
  tooFar: boolean;
  /** Each part of the charge, in order, for showing how it adds up. */
  steps: { label: string; amount: number }[];
  total: number;
}

/** The charge for one doorstep visit `km` from the branch, at `at` (for busy-time extras). */
export function visitCharge(km: number, rules: DoorstepVisitRules, at: Date): VisitCharge {
  const d = Math.max(0, Math.round(km * 10) / 10);
  if (d > rules.maxKm) return { km: d, tooFar: true, steps: [], total: 0 };
  const steps: VisitCharge['steps'] = [];
  if (rules.visitFeePaise) steps.push({ label: 'Visit fee', amount: rules.visitFeePaise });
  const paidKm = Math.ceil(Math.max(0, d - rules.freeKm) - 1e-9);
  if (paidKm > 0 && rules.perKmPaise) steps.push({ label: `${paidKm} km beyond ${rules.freeKm} km`, amount: paidKm * rules.perKmPaise });
  for (const b of busyExtrasAt(rules, at)) steps.push({ label: `Busy time ${b.from}–${b.to}`, amount: b.extraPaise });
  const sum = steps.reduce((n, s) => n + s.amount, 0);
  const total = rules.roundTo9 ? roundUpTo9(sum) : sum;
  if (total !== sum) steps.push({ label: 'Rounded', amount: total - sum });
  return { km: d, tooFar: false, steps, total };
}

// ─── Community neighbours discount ───────────────────────────────────────────

/**
 * Head office's community markup on the hub price, by default (10%: ₹499 → ₹549). The markup is
 * the community rule on the price list (Prices › Community); it can't take a price below the hub.
 */
export const COMMUNITY_MARKUP_DEFAULT_BP = 1000;

/** The neighbours discount when every flat washes with us, by default (10%). */
export const JOIN_DISCOUNT_DEFAULT_BP = 1000;
/** The most head office can give when every flat joins. */
export const JOIN_DISCOUNT_MAX_BP = 2000;
/** The discount grows in steps of this share of the flats: every 10% of flats, a tenth of the discount. */
export const JOIN_STEPS = 10;

/** Why a neighbours discount can't be saved, or null when it can. */
export function joinDiscountProblem(bp: number): string | null {
  if (!Number.isInteger(bp) || bp < 0 || bp > JOIN_DISCOUNT_MAX_BP || bp % 100 !== 0) {
    return `The discount is 0% to ${JOIN_DISCOUNT_MAX_BP / 100}%, in whole percents.`;
  }
  return null;
}

/** The stored setting, or the default when missing or broken. */
export function parseJoinDiscountBp(value: string | null | undefined): number {
  if (value == null || value === '') return JOIN_DISCOUNT_DEFAULT_BP;
  const n = Number(value);
  return joinDiscountProblem(n) ? JOIN_DISCOUNT_DEFAULT_BP : n;
}

/** How much of a community washes with us, and what that's worth to every flat there. */
export interface CommunityJoin {
  /** Flats with a plan running, or a wash booked this month. */
  joined: number;
  /** Flats on the community's list. */
  flats: number;
  /** Off every community price there now (basis points). */
  discountBp: number;
  /** Off when every flat joins. */
  maxBp: number;
  /** Flats still to join for the next step, with what it brings; null at the top or with no flats. */
  next: { flats: number; discountBp: number } | null;
}

/**
 * The neighbours discount: every tenth of the flats that joins takes a tenth of `maxBp` off every
 * flat's price (10 flats, 7 joined, 10% at most → 7% off). A community with no flats on its list
 * gets none.
 */
export function communityJoin(joined: number, flats: number, maxBp: number): CommunityJoin {
  const total = Math.max(0, Math.floor(flats));
  const have = Math.min(total, Math.max(0, Math.floor(joined)));
  if (!total || maxBp <= 0) return { joined: have, flats: total, discountBp: 0, maxBp: Math.max(0, maxBp), next: null };
  const step = Math.floor((have * JOIN_STEPS) / total);
  const at = (s: number) => Math.round((maxBp * s) / JOIN_STEPS);
  let next: CommunityJoin['next'] = null;
  if (step < JOIN_STEPS) {
    // The fewest flats that reach a higher step (a small community can jump more than one).
    const need = Math.ceil(((step + 1) * total) / JOIN_STEPS);
    next = { flats: need - have, discountBp: at(Math.floor((need * JOIN_STEPS) / total)) };
  }
  return { joined: have, flats: total, discountBp: at(step), maxBp, next };
}

/** A price less a discount, to the rupee. */
export function lessDiscount(paise: number, discountBp: number): number {
  return Math.round((paise * (10_000 - discountBp)) / 10_000 / 100) * 100;
}

/**
 * What a community pays: the community price less the neighbours discount, but never less than
 * the hub price for the same wash (null = not sold at the shop, so nothing to hold it to).
 */
export function communityPrice(community: number, hub: number | null, discountBp: number): number {
  const less = discountBp > 0 ? lessDiscount(community, discountBp) : community;
  return hub != null ? Math.max(Math.min(hub, community), less) : less;
}

/**
 * The neighbours discount in words, for customers and staff: "7 of 10 flats wash with us: 7% off
 * every price here." and "1 more flat → 8% off for everyone." Null with no flats on the list.
 */
export function joinWords(join: CommunityJoin | null): { now: string; next: string | null } | null {
  if (!join || !join.flats || !join.maxBp) return null;
  const pct = (bp: number) => `${bp / 100}%`;
  const flats = (n: number) => `${n} flat${n === 1 ? '' : 's'}`;
  const share = `${join.joined} of ${flats(join.flats)} wash with us`;
  const now = join.discountBp
    ? `${share}: ${pct(join.discountBp)} off every price here.`
    : join.joined
      ? `${share}. More neighbours joining means a lower price for everyone.`
      : `Be the first of ${flats(join.flats)} here. Every 10% of flats that join takes ${pct(join.maxBp / 10)} off for everyone.`;
  const next = join.next ? `${join.next.flats} more ${join.next.flats === 1 ? 'flat' : 'flats'} → ${pct(join.next.discountBp)} off for everyone.` : null;
  return { now, next };
}
