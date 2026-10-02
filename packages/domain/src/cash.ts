/**
 * Daily cash close. The drawer should hold the morning float plus every cash payment taken
 * that day, minus every expense paid out of it in cash. Anything else is a difference the
 * closer has to explain.
 */

/** ₹5,00,000 — a float or count above this is certainly a typo, not a day's cash. */
export const MAX_CASH_PAISE = 5_00_000 * 100;

export interface CashDayTotals {
  openingFloat: number;
  cashIn: number;
  cashExpenses: number;
}

export function expectedCash({ openingFloat, cashIn, cashExpenses }: CashDayTotals): number {
  return openingFloat + cashIn - cashExpenses;
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
