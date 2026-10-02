import type { JobStatus, PaymentMethod } from './types';

export type UserRole = 'owner' | 'staff';

export const USER_ROLES: readonly UserRole[] = ['owner', 'staff'];

/** Wrong-PIN attempts allowed before the account's PIN sign-in is locked. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

/**
 * Owner sign-in codes, sent on WhatsApp for a first sign-in or a forgotten PIN (staff PINs are
 * set by the owner, so staff never get one). Each code allows a few guesses; the hourly cap on
 * new codes bounds both guessing and message cost.
 */
export const LOGIN_CODE_LENGTH = 6;
export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_RESEND_SECONDS = 30;
export const LOGIN_CODES_PER_HOUR = 5;
/** Sign-up codes go to numbers without an account, so one device is also capped across numbers. */
export const SIGNUP_CODES_PER_IP_PER_HOUR = 20;

/** New shops: a free trial, and a 6-digit shop ID staff use to ask to join. */
export const SHOP_TRIAL_DAYS = 14;
export const SHOP_CODE_LENGTH = 6;
/** Branches one owner can run on one number; each is its own shop with its own trial and plan. */
export const MAX_SHOPS_PER_OWNER = 10;

/** Requests to join a shop wait this long for the owner, and a shop holds at most this many. */
export const JOIN_REQUEST_TTL_DAYS = 7;
export const JOIN_REQUESTS_PER_SHOP = 10;

export function isValidShopCode(code: string): boolean {
  return new RegExp(`^\\d{${SHOP_CODE_LENGTH}}$`).test(code);
}

/** "482193" → "482 193", easier to read aloud. */
export function formatShopCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type PinProblem = 'format' | 'repeated' | 'sequence';

/**
 * PINs are 4–6 digits. Trivially guessable ones (0000, 1234, 9876…) are rejected because a
 * PIN is the only thing between a lost phone and the day's cash totals.
 */
export function checkPin(pin: string): PinProblem | null {
  if (!/^\d{4,6}$/.test(pin)) return 'format';
  if (/^(\d)\1+$/.test(pin)) return 'repeated';
  const digits = pin.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 9) % 10);
  if (ascending || descending) return 'sequence';
  return null;
}

export function pinProblemMessage(problem: PinProblem): string {
  switch (problem) {
    case 'format':
      return 'PIN must be 4 to 6 digits.';
    case 'repeated':
      return 'PIN can’t be the same digit repeated.';
    case 'sequence':
      return 'PIN can’t be a simple sequence like 1234.';
  }
}

/**
 * Stored phones are plain 10-digit Indian mobile numbers. Accepts what people actually type:
 * spaces, dashes, a leading 0, or a +91 / 91 prefix.
 */
export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  return digits;
}

export function isValidPhone(input: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizePhone(input));
}

/** Minimum length for a void / correction reason — "mistake" is fine, "x" is not. */
export const MIN_REASON_LENGTH = 3;

/**
 * Unpaid jobs can be voided by anyone on shift (wrong car entered, customer left). A paid job
 * means money changed hands, so undoing it is an owner-only correction.
 */
export function canVoidJob(status: JobStatus, role: UserRole): boolean {
  if (status === 'void') return false;
  if (status === 'paid') return role === 'owner';
  return true;
}

/** Changing how a paid job was paid (cash ↔ UPI) moves money between reconciliation buckets. */
export function canCorrectPayment(status: JobStatus, role: UserRole): boolean {
  return status === 'paid' && role === 'owner';
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'upi', 'other'];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  other: 'Other',
};

export type JobEventAction =
  | 'created'
  | 'status_changed'
  | 'paid'
  | 'voided'
  | 'payment_method_changed'
  | 'washers_changed'
  | 'sellers_changed';

export type ExpenseCategory =
  'chemicals' | 'labour' | 'electricity' | 'water' | 'maintenance' | 'other';

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'chemicals',
  'labour',
  'electricity',
  'water',
  'maintenance',
  'other',
];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  chemicals: 'Chemicals',
  labour: 'Labour',
  electricity: 'Electricity',
  water: 'Water',
  maintenance: 'Maintenance',
  other: 'Other',
};

/** How much of something an expense bought. `kwh` is what an electricity bill calls "units". */
export type ExpenseUnit = 'ml' | 'l' | 'g' | 'kg' | 'pcs' | 'kwh' | 'days' | 'hours' | 'tankers';

export const EXPENSE_UNITS: readonly ExpenseUnit[] = [
  'ml',
  'l',
  'g',
  'kg',
  'pcs',
  'kwh',
  'days',
  'hours',
  'tankers',
];

export const EXPENSE_UNIT_LABEL: Record<ExpenseUnit, string> = {
  ml: 'ml',
  l: 'L',
  g: 'g',
  kg: 'kg',
  pcs: 'pcs',
  kwh: 'units',
  days: 'days',
  hours: 'hours',
  tankers: 'tankers',
};

export interface ExpenseCategorySetup {
  /** Label for the "what was bought" field, e.g. "Chemical name". */
  itemLabel: string;
  itemPlaceholder: string;
  itemSuggestions: string[];
  /** Units that make sense for this category; the first is the default. */
  units: ExpenseUnit[];
  /** Whether a quantity must be entered (tea & snacks don't need one; chemicals do). */
  quantityRequired: boolean;
  /** What the two required photos are called for this category. */
  billPhotoLabel: string;
  itemPhotoLabel: string;
  itemPhotoHint: string;
  /** Label for the free-text field, e.g. "Used for" on chemicals. */
  noteLabel: string;
  notePlaceholder: string;
  noteSuggestions: string[];
}

/** Every expense carries proof: the bill and a photo of what was bought. */
export type ExpensePhotoKind = 'bill' | 'item';
export const EXPENSE_PHOTO_KINDS: readonly ExpensePhotoKind[] = ['bill', 'item'];

/** Items counted in pieces even inside a liquid-heavy category (cloths, brushes…). */
const PIECE_ITEMS = /cloth|brush|sponge|towel|mitt|bucket|nozzle|pipe|gun|spare|part|bulb|battery/i;

export const EXPENSE_CATEGORY_SETUP: Record<ExpenseCategory, ExpenseCategorySetup> = {
  chemicals: {
    itemLabel: 'Product name',
    itemPlaceholder: 'e.g. Foam shampoo',
    itemSuggestions: [
      'Foam shampoo',
      'Car wax',
      'Tyre shine',
      'Dashboard polish',
      'Glass cleaner',
      'Microfibre cloth',
      'Brush',
      'Sponge',
    ],
    units: ['l', 'ml', 'kg', 'g', 'pcs'],
    quantityRequired: true,
    billPhotoLabel: 'Bill',
    itemPhotoLabel: 'Product',
    itemPhotoHint: 'The bottle, can or pack',
    noteLabel: 'Used for',
    notePlaceholder: 'e.g. Foam wash on cars',
    noteSuggestions: ['Foam wash', 'Interior cleaning', 'Polishing', 'Tyres', 'Glass', 'Bikes'],
  },
  labour: {
    itemLabel: 'Work / worker',
    itemPlaceholder: 'e.g. Daily wages – Ravi',
    itemSuggestions: ['Daily wages', 'Helper', 'Overtime', 'Advance'],
    units: ['days', 'hours'],
    quantityRequired: true,
    billPhotoLabel: 'Payment slip',
    itemPhotoLabel: 'Worker',
    itemPhotoHint: 'The person who was paid',
    noteLabel: 'Note',
    notePlaceholder: 'e.g. Sunday rush',
    noteSuggestions: [],
  },
  electricity: {
    itemLabel: 'Bill / item',
    itemPlaceholder: 'e.g. Monthly bill',
    itemSuggestions: ['Monthly bill', 'Generator diesel', 'Inverter battery'],
    units: ['kwh', 'l'],
    quantityRequired: true,
    billPhotoLabel: 'Bill',
    itemPhotoLabel: 'Meter',
    itemPhotoHint: 'Meter reading or diesel can',
    noteLabel: 'Note',
    notePlaceholder: 'e.g. Meter reading 4520',
    noteSuggestions: ['September bill', 'October bill'],
  },
  water: {
    itemLabel: 'Bill / item',
    itemPlaceholder: 'e.g. Water tanker',
    itemSuggestions: ['Water tanker', 'Monthly bill', 'Borewell motor'],
    units: ['tankers', 'l'],
    quantityRequired: true,
    billPhotoLabel: 'Bill',
    itemPhotoLabel: 'Tanker / meter',
    itemPhotoHint: 'The tanker or water meter',
    noteLabel: 'Note',
    notePlaceholder: 'e.g. 5000 L tanker',
    noteSuggestions: [],
  },
  maintenance: {
    itemLabel: 'Part / repair',
    itemPlaceholder: 'e.g. Pressure washer nozzle',
    itemSuggestions: ['Pressure washer repair', 'Nozzle', 'Pipe', 'Vacuum service', 'Spare parts'],
    units: ['pcs'],
    quantityRequired: true,
    billPhotoLabel: 'Bill',
    itemPhotoLabel: 'Part / repair',
    itemPhotoHint: 'The new part or the fixed machine',
    noteLabel: 'Note',
    notePlaceholder: 'e.g. Bay 2 machine',
    noteSuggestions: [],
  },
  other: {
    itemLabel: 'What was it?',
    itemPlaceholder: 'e.g. Tea & snacks',
    itemSuggestions: ['Tea & snacks', 'Rent', 'Stationery', 'Transport'],
    units: ['pcs'],
    quantityRequired: false,
    billPhotoLabel: 'Bill',
    itemPhotoLabel: 'Item',
    itemPhotoHint: 'What was bought',
    noteLabel: 'Note',
    notePlaceholder: 'Anything to remember',
    noteSuggestions: [],
  },
};

/** Best unit for an item: pieces for cloths/brushes/parts, otherwise the category default. */
export function defaultExpenseUnit(category: ExpenseCategory, itemName: string): ExpenseUnit {
  const units = EXPENSE_CATEGORY_SETUP[category].units;
  if (units.includes('pcs') && PIECE_ITEMS.test(itemName)) return 'pcs';
  return units[0]!;
}

/**
 * Quantity in a comparable base unit (ml → L, g → kg) so "500 ml" and "2 L" of the same
 * product add up, and the price per unit reads naturally (₹/L, ₹/kg).
 */
export function normalizeExpenseQuantity(
  quantity: number,
  unit: ExpenseUnit,
): { quantity: number; unit: ExpenseUnit } {
  if (unit === 'ml') return { quantity: quantity / 1000, unit: 'l' };
  if (unit === 'g') return { quantity: quantity / 1000, unit: 'kg' };
  return { quantity, unit };
}

/** "5 L", "500 ml", "120 units", "1.5 days", "1 day". */
export function formatExpenseQuantity(quantity: number, unit: ExpenseUnit): string {
  const n = Number.isInteger(quantity)
    ? String(quantity)
    : String(Math.round(quantity * 100) / 100);
  const label = EXPENSE_UNIT_LABEL[unit];
  return `${n} ${quantity === 1 && unit !== 'pcs' ? label.replace(/s$/, '') : label}`;
}

/** Offline entries carry the time they actually happened; accept up to a week of backlog. */
export const MAX_OFFLINE_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves the effective timestamp for an action replayed from the offline queue. Future
 * times (clock skew) and anything older than the backlog window fall back to `now`.
 */
export function resolveOccurredAt(occurredAt: string | undefined, now: Date = new Date()): Date {
  if (!occurredAt) return now;
  const t = new Date(occurredAt);
  if (Number.isNaN(t.getTime())) return now;
  if (t.getTime() > now.getTime()) return now;
  if (now.getTime() - t.getTime() > MAX_OFFLINE_BACKDATE_MS) return now;
  return t;
}
