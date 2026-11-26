/**
 * Rewards: stamp cards and welcome gifts.
 *
 * Stamp cards — the owner picks services and how many paid visits earn one free wash. Each car
 * keeps its own card per service. A card is never stored: it is worked out from the car's wash
 * history, so a voided wash, a voided free wash or a changed rule can never leave it wrong.
 *
 * Welcome gifts — items from Inventory handed over on a car's first paid visit. When an item is
 * out of stock the gift is kept as owed and handed over later; owed gifts never expire.
 *
 * Everything here is pure; the API supplies the history and the clock.
 */

/** A card (and any free wash saved on it) resets when the car skips that service this long. */
export const REWARD_RESET_MONTHS = 6;
/** Staff are warned this many days before a card resets. */
export const REWARD_EXPIRY_WARN_DAYS = 10;
/** Paid visits that earn one free wash. */
export const STAMP_EVERY_MIN = 2;
export const STAMP_EVERY_MAX = 100;
/** Items in the welcome gift. */
export const GIFT_ITEMS_MAX = 5;
/** Biggest quantity of one item in the welcome gift (in the item's stock unit). */
export const GIFT_QUANTITY_MAX = 100;
/** Discount reason written on a wash that uses a free wash. */
export const REWARD_DISCOUNT_REASON = 'Loyalty reward';
/** Most stamps one wash can put on a card (Premium = 2). */
export const STAMP_WEIGHT_MAX = 3;
/** A new card's defaults: 10 stamps for a free wash, and 2 welcome stamps on the first wash. */
export const STAMP_EVERY_DEFAULT = 10;
export const BONUS_STAMPS_DEFAULT = 2;
/** Most welcome stamps a card can give: half the card, so one wash never fills it alone. */
export const maxBonusStamps = (every: number) => Math.max(0, Math.floor(every / 2));
export const isValidBonusStamps = (bonus: number, every: number) =>
  Number.isInteger(bonus) && bonus >= 0 && bonus <= maxBonusStamps(every);
export const isValidStampWeight = (n: number) => Number.isInteger(n) && n >= 1 && n <= STAMP_WEIGHT_MAX;

const DAY_MS = 86_400_000;

/**
 * `at` plus whole calendar months, in UTC. A day that doesn't exist in the target month clamps
 * to its last day: 31 Aug + 6 months = 28/29 Feb.
 */
export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** One visit for a card's service: paid (earns stamps) or a free wash used from the card. */
export interface StampVisit {
  at: Date;
  free: boolean;
  /** Stamps a paid visit puts on the card (Premium = 2); 1 when not given. */
  stamps?: number;
}

export interface StampCardOptions {
  /** Welcome stamps added on the car's first paid visit (once, never again after a reset). */
  bonus?: number;
}

export interface StampCard {
  /** Stamps towards the next free wash, 0 … every−1. */
  stamps: number;
  /** Free washes earned and not yet used. */
  free: number;
  /** Last visit for this service; null if never. */
  lastVisitAt: Date | null;
  /**
   * When the card resets (stamps and saved free washes are lost) unless the car gets this
   * service again; null when there is nothing to lose.
   */
  expiresAt: Date | null;
  /** Paid visits since the card last started (or reset); 1 = the visit that opened it. */
  paidVisits: number;
  /** Welcome stamps that went on the card in its current run (0 after a reset). */
  bonus: number;
}

const EMPTY_CARD: StampCard = { stamps: 0, free: 0, lastVisitAt: null, expiresAt: null, paidVisits: 0, bonus: 0 };

/**
 * Plays a car's visits for one card forward: each paid visit adds its stamps (the very first one
 * also the welcome bonus), every `every` stamps turn into one free wash (extra stamps carry
 * over), a used free wash comes off (and earns no stamp), and a gap of REWARD_RESET_MONTHS
 * between visits — or since the last visit — clears the card.
 */
export function stampCard(every: number, visits: readonly StampVisit[], now: Date, opts: StampCardOptions = {}): StampCard {
  if (!Number.isInteger(every) || every < 1) return EMPTY_CARD;
  const welcome = Number.isInteger(opts.bonus) && opts.bonus! > 0 ? opts.bonus! : 0;
  const ordered = [...visits].sort((a, b) => a.at.getTime() - b.at.getTime());
  let stamps = 0;
  let free = 0;
  let paidVisits = 0;
  let bonus = 0;
  let welcomed = false;
  let last: Date | null = null;
  for (const v of ordered) {
    if (last && v.at.getTime() >= addMonths(last, REWARD_RESET_MONTHS).getTime()) {
      stamps = 0;
      free = 0;
      paidVisits = 0;
      bonus = 0;
    }
    if (v.free) {
      free = Math.max(0, free - 1);
    } else {
      const weight = Number.isInteger(v.stamps) && v.stamps! > 0 ? v.stamps! : 1;
      stamps += weight;
      paidVisits += 1;
      if (!welcomed) {
        welcomed = true;
        stamps += welcome;
        bonus = welcome;
      }
      while (stamps >= every) {
        stamps -= every;
        free += 1;
      }
    }
    last = v.at;
  }
  if (!last) return EMPTY_CARD;
  const resetAt = addMonths(last, REWARD_RESET_MONTHS);
  if (now.getTime() >= resetAt.getTime()) {
    return { stamps: 0, free: 0, lastVisitAt: last, expiresAt: null, paidVisits: 0, bonus: 0 };
  }
  return {
    stamps,
    free,
    lastVisitAt: last,
    expiresAt: stamps > 0 || free > 0 ? resetAt : null,
    paidVisits,
    bonus,
  };
}

/** Whole days until a card resets, rounded up (resets later today = 1); null if nothing to lose. */
export function daysUntilReset(card: Pick<StampCard, 'expiresAt'>, now: Date): number | null {
  if (!card.expiresAt) return null;
  return Math.max(0, Math.ceil((card.expiresAt.getTime() - now.getTime()) / DAY_MS));
}

/** True when staff should be warned that the card resets soon. */
export function isRewardExpiringSoon(card: Pick<StampCard, 'expiresAt'>, now: Date): boolean {
  const days = daysUntilReset(card, now);
  return days != null && days <= REWARD_EXPIRY_WARN_DAYS;
}

/** Paid visits still needed for the next free wash. */
export function stampsToGo(every: number, card: Pick<StampCard, 'stamps'>): number {
  return Math.max(0, every - card.stamps);
}

/** Walk-in plates aren't a real car to remember, so they never collect stamps or gifts. */
export function isRewardEligiblePlate(registrationNumber: string): boolean {
  return !registrationNumber.startsWith('WALK-IN');
}

export function isValidStampEvery(n: number): boolean {
  return Number.isInteger(n) && n >= STAMP_EVERY_MIN && n <= STAMP_EVERY_MAX;
}

/** "Every 10 washes → 1 free". */
export function stampRuleLabel(every: number): string {
  return `Every ${every} washes → 1 free`;
}
