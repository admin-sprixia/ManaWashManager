/**
 * Prices away from the shop. Three ways a car is washed, three ways to price it:
 *
 *   Hub        the base price: the customer comes to the shop.
 *   Community  the community price: the team washes many cars at one place on a wash day, so its
 *              travel is shared and each car pays less (a set price, or the hub price less a %),
 *              and a bigger community can earn a volume discount.
 *   Doorstep   the hub price plus one visit charge per visit to a home: a visit fee, then a charge
 *              per km beyond the free distance from the branch, up to the furthest the team goes,
 *              plus any busy-time extra. Two cars at one home share the visit charge.
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
  visitFeePaise: 4900,
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

// ─── Community volume discount ───────────────────────────────────────────────

/** From this many cars at one community, this much off (in basis points: 1000 = 10%). */
export interface CommunityTier {
  minCars: number;
  discountBp: number;
}

export const COMMUNITY_TIERS_MAX = 6;
/** However many cars a community has, its volume discount stops at 10%. */
export const COMMUNITY_TIER_MAX_BP = 1000;

export function communityTiersProblem(tiers: CommunityTier[]): string | null {
  if (tiers.length > COMMUNITY_TIERS_MAX) return `Up to ${COMMUNITY_TIERS_MAX} steps.`;
  const seen = new Set<number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.minCars) || t.minCars < 2 || t.minCars > 1000) return 'Each step starts at 2 cars or more.';
    if (seen.has(t.minCars)) return 'Two steps start at the same number of cars.';
    seen.add(t.minCars);
    if (!Number.isInteger(t.discountBp) || t.discountBp < 100 || t.discountBp > COMMUNITY_TIER_MAX_BP) {
      return `Each discount is 1% to ${COMMUNITY_TIER_MAX_BP / 100}%.`;
    }
  }
  const sorted = [...tiers].sort((a, b) => a.minCars - b.minCars);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.discountBp <= sorted[i - 1]!.discountBp) return 'More cars should get a bigger discount.';
  }
  return null;
}

export function parseCommunityTiers(value: string | null | undefined): CommunityTier[] {
  if (!value) return [];
  try {
    const list = JSON.parse(value) as CommunityTier[];
    if (!Array.isArray(list) || communityTiersProblem(list)) return [];
    return [...list].sort((a, b) => a.minCars - b.minCars);
  } catch {
    return [];
  }
}

/** The step a community with `cars` cars is on, or null below the first step. */
export function communityTierFor(tiers: readonly CommunityTier[], cars: number): CommunityTier | null {
  let found: CommunityTier | null = null;
  for (const t of [...tiers].sort((a, b) => a.minCars - b.minCars)) if (cars >= t.minCars) found = t;
  return found;
}

/** A price less a discount, to the rupee. */
export function lessDiscount(paise: number, discountBp: number): number {
  return Math.round((paise * (10_000 - discountBp)) / 10_000 / 100) * 100;
}
