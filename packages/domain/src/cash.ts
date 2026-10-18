/**
 * Daily cash close. The drawer should hold the morning float plus every cash payment taken at
 * the shop that day, plus doorstep cash handed in that day, minus every expense paid out of it
 * in cash. Anything else is a difference the closer has to explain.
 *
 * Doorstep cash is collected away from the shop, so it isn't in the box until the team member
 * hands it over. Until then it is theirs to account for: what they collected, less what they
 * have handed over, is what they still hold — carried from day to day until it's settled.
 */

/** ₹5,00,000 — a float or count above this is certainly a typo, not a day's cash. */
export const MAX_CASH_PAISE = 5_00_000 * 100;

export interface CashDayTotals {
  openingFloat: number;
  /** Cash taken at the shop. */
  cashIn: number;
  /** Doorstep cash that reached the box (what was actually received at handovers). */
  handedIn: number;
  cashExpenses: number;
}

export function expectedCash({ openingFloat, cashIn, handedIn, cashExpenses }: CashDayTotals): number {
  return openingFloat + cashIn + handedIn - cashExpenses;
}

/**
 * Where a cash expense was paid from: the shop's box, or doorstep cash the person who entered it
 * was holding (fuel on the way, supplies at a customer's). Either way it's an expense; only the
 * box's expenses come off the drawer, and held ones come off what that person holds.
 */
export const EXPENSE_CASH_SOURCES = ['drawer', 'held'] as const;
export type ExpenseCashSource = (typeof EXPENSE_CASH_SOURCES)[number];

/**
 * Doorstep cash a team member still has: all they collected, less what their handovers settled
 * and what they spent from it (pass both together as `settled`).
 * Never negative — a payment corrected from cash to UPI after a handover shows as a handover
 * difference, not as cash the shop owes them.
 */
export function cashHeld(collected: number, settled: number): number {
  return Math.max(0, collected - settled);
}

/** Positive = handed in more than they held; negative = short. */
export function handoverDifference(due: number, received: number): number {
  return received - due;
}

/** Positive = more cash in the drawer than expected; negative = short. */
export function cashDifference(expected: number, counted: number): number {
  return counted - expected;
}

/** A drawer that doesn't match needs a written reason before the day can be closed. */
export function closeNeedsNote(difference: number): boolean {
  return difference !== 0;
}

/** Staff may close today or a forgotten yesterday; older days are the owner's to sort out. */
export const STAFF_CLOSE_WINDOW_DAYS = 1;
