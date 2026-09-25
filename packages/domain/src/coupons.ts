/**
 * Win-back reminders and comeback coupons. Everything here is pure: the API supplies the
 * randomness (Web Crypto) and the clock, so the rules are testable and identical everywhere.
 */

const DAY_MS = 86_400_000;

/** A vehicle shows up as "due for a wash" this many days after its last visit. */
export const REMINDER_DUE_DAYS = 10;
/** …and becomes eligible for a comeback coupon after this many. */
export const COMEBACK_DAYS = 30;
export const COUPON_VALID_DAYS = 14;
export const COUPON_MIN_PERCENT = 5;
export const COUPON_MAX_PERCENT = 10;
export const REMINDER_SNOOZE_DAYS = 3;

/** No 0/O or 1/I, so a code read out over the phone can't be misheard. 32 symbols. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RANDOM_LENGTH = 6;
export const COUPON_CODE_PATTERN = /^MANA-[A-Z0-9]{4}-[A-HJ-NP-Z2-9]{6}$/;

export type ReminderBucket = 'due' | 'comeback';

/** Whole days between two instants, floored — a visit 9 days 23 hours ago is 9 days ago. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function reminderBucket(daysSinceVisit: number): ReminderBucket | null {
  if (daysSinceVisit >= COMEBACK_DAYS) return 'comeback';
  if (daysSinceVisit >= REMINDER_DUE_DAYS) return 'due';
  return null;
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}

/** Last four digits of the plate (padded from its letters when it has fewer), for a human sanity check. */
function plateTag(registrationNumber: string): string {
  const clean = registrationNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = clean.replace(/\D/g, '');
  const tag = digits.length >= 4 ? digits.slice(-4) : clean.slice(-4);
  return tag.padStart(4, 'X');
}

/**
 * `MANA-1234-7QX2KD`: plate tag + 6 random symbols (30 bits). `randomBytes` must come from a
 * CSPRNG; 256 is a multiple of 32, so `byte % 32` is unbiased.
 */
export function generateCouponCode(registrationNumber: string, randomBytes: Uint8Array): string {
  if (randomBytes.length < CODE_RANDOM_LENGTH) throw new Error('Not enough random bytes');
  let suffix = '';
  for (let i = 0; i < CODE_RANDOM_LENGTH; i++) suffix += CODE_ALPHABET[randomBytes[i]! % 32];
  return `MANA-${plateTag(registrationNumber)}-${suffix}`;
}

/**
 * A uniformly random whole percentage in [5, 10]. Bytes ≥ 252 are rejected so every value is
 * equally likely; returns null if all supplied bytes were rejected (caller draws again).
 */
export function pickCouponPercent(randomBytes: Uint8Array): number | null {
  const span = COUPON_MAX_PERCENT - COUPON_MIN_PERCENT + 1;
  const limit = 256 - (256 % span);
  for (const byte of randomBytes) {
    if (byte < limit) return COUPON_MIN_PERCENT + (byte % span);
  }
  return null;
}

/** Discount in paise, rounded down to a whole rupee so the bill never shows paise. */
export function couponDiscount(subtotal: number, percent: number): number {
  if (subtotal <= 0 || percent <= 0) return 0;
  const raw = Math.floor((subtotal * percent) / 100);
  return Math.min(subtotal, Math.floor(raw / 100) * 100);
}

export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function isCouponExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
