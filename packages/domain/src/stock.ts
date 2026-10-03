import type { ExpenseCategory, ExpenseUnit } from './team';

/**
 * Inventory: how much of each consumable the shop has. Balances are kept in a base unit
 * (L, kg, pieces) so "500 ml" bought and "200 ml" used come off the same number.
 */
export type StockUnit = 'l' | 'kg' | 'pcs';

export const STOCK_UNITS: readonly StockUnit[] = ['l', 'kg', 'pcs'];

export const STOCK_UNIT_LABEL: Record<StockUnit, string> = {
  l: 'Litres',
  kg: 'Kilograms',
  pcs: 'Pieces',
};

/**
 * What changed a balance: bought (in), used up, a physical count, an expense or gift voided, or
 * handed to a customer as a welcome gift.
 */
export type StockMoveKind = 'in' | 'use' | 'count' | 'void' | 'gift';

/** Expense categories whose purchases can go into stock. */
export const STOCK_CATEGORIES: readonly ExpenseCategory[] = ['chemicals', 'maintenance', 'other'];

/** Biggest single move or balance — anything above is a typo (extra zeros). */
export const MAX_STOCK_QUANTITY = 100_000;

export const STOCK_NAME_MAX = 60;

/** Which stock unit an entered unit belongs to (ml → L, g → kg); null for kWh, days… */
export function stockUnitOf(unit: ExpenseUnit): StockUnit | null {
  if (unit === 'ml' || unit === 'l') return 'l';
  if (unit === 'g' || unit === 'kg') return 'kg';
  if (unit === 'pcs') return 'pcs';
  return null;
}

/** Units someone can type an amount in for an item kept in `unit`. Small one first. */
export function entryUnitsFor(unit: StockUnit): ExpenseUnit[] {
  if (unit === 'l') return ['ml', 'l'];
  if (unit === 'kg') return ['g', 'kg'];
  return ['pcs'];
}

/** Converts an entered amount into the item's stock unit; null when the units don't match. */
export function toStockQuantity(
  quantity: number,
  entered: ExpenseUnit,
  unit: StockUnit,
): number | null {
  if (stockUnitOf(entered) !== unit) return null;
  const n = entered === 'ml' || entered === 'g' ? quantity / 1000 : quantity;
  return roundStock(n);
}

/** Balances are kept to 3 decimals (1 ml / 1 g) so repeated adds don't drift. */
export function roundStock(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "2.5 L", "450 ml", "1.2 kg", "300 g", "12 pcs" — small amounts in ml / g read naturally. */
export function formatStock(quantity: number, unit: StockUnit): string {
  const sign = quantity < 0 ? '−' : '';
  const q = Math.abs(quantity);
  if (unit === 'l') return q > 0 && q < 1 ? `${sign}${trim(q * 1000)} ml` : `${sign}${trim(q)} L`;
  if (unit === 'kg') return q > 0 && q < 1 ? `${sign}${trim(q * 1000)} g` : `${sign}${trim(q)} kg`;
  return `${sign}${trim(q)} pcs`;
}

export type StockLevel = 'out' | 'low' | 'ok';

/** Out at zero or below; low at or under the owner's alert level; otherwise fine. */
export function stockLevel(balance: number, lowAt: number | null): StockLevel {
  if (balance <= 0) return 'out';
  if (lowAt != null && balance <= lowAt) return 'low';
  return 'ok';
}

/** Matching key for names: "Foam  Shampoo " and "foam shampoo" are the same item. */
export function stockKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Starter list offered on an empty inventory screen. */
export const STOCK_SUGGESTIONS: { name: string; unit: StockUnit; lowAt: number }[] = [
  { name: 'Foam shampoo', unit: 'l', lowAt: 5 },
  { name: 'Car wax', unit: 'l', lowAt: 1 },
  { name: 'Tyre shine', unit: 'l', lowAt: 1 },
  { name: 'Dashboard polish', unit: 'l', lowAt: 1 },
  { name: 'Glass cleaner', unit: 'l', lowAt: 1 },
  { name: 'Microfibre cloth', unit: 'pcs', lowAt: 10 },
  { name: 'Bill book', unit: 'pcs', lowAt: 2 },
];
