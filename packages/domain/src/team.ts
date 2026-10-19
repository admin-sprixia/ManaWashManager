import type { JobStatus, PaymentMethod } from './types';

/**
 * owner: everything for the branch. manager: the team (staff only), plus everything staff do; no
 * money fixes, prices or reports. staff: washes and payments. Only Mana Wash HQ adds or removes
 * owners.
 */
export const USER_ROLES = ['owner', 'manager', 'staff'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

export function toUserRole(role: string): UserRole {
  return role === 'owner' || role === 'manager' ? role : 'staff';
}

/** Owners and managers run the team, so their PINs must be longer. */
export function isSeniorRole(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * Whether someone in `actor`'s role may add, turn off, remove or reset the PIN of someone in
 * `target`'s role at the same branch. Owners are HQ's alone (`hq`).
 */
export function canManageMember(actor: UserRole, target: UserRole, hq = false): boolean {
  if (target === 'owner') return hq;
  if (target === 'manager') return hq || actor === 'owner';
  return hq || actor === 'owner' || actor === 'manager';
}

/** Wrong-PIN attempts allowed before the account's PIN sign-in is locked. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;
/** Each lock in a row lasts longer: 15 minutes, then 1 hour, then a day each time. */
export const PIN_LOCK_STEPS_MINUTES = [PIN_LOCK_MINUTES, 60, 24 * 60] as const;

/**
 * Sign-in codes, sent on WhatsApp: on a new phone, for a first sign-in, or after a forgotten or
 * reset PIN. Each code allows a few guesses; the hourly cap on new codes bounds both guessing
 * and message cost.
 */
export const LOGIN_CODE_LENGTH = 6;
export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_RESEND_SECONDS = 30;
export const LOGIN_CODES_PER_HOUR = 5;
/** Codes to numbers that aren't a team sign-in (the customer app), so one device is also capped across numbers. */
export const SIGNUP_CODES_PER_IP_PER_HOUR = 20;

/** Branches one person can work at on one number. */
export const MAX_BRANCHES_PER_PERSON = 10;

/**
 * Every branch has a code from its town: the town's 3-letter code and a number, KVR-001, KVR-002,
 * HYD-001. The app gives the town its code (branchTowns.ts); the number is the next free one.
 */
export function isValidTownCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** "KVR", 1 → "KVR-001". */
export function branchCode(townCode: string, n: number): string {
  return `${townCode}-${String(n).padStart(3, '0')}`;
}

export type PinProblem = 'format' | 'too_short' | 'repeated' | 'sequence';

/** Owners, managers and HQ need this many digits; staff may use 4 to 6. */
export const SENIOR_PIN_DIGITS = 6;
export const MIN_PIN_DIGITS = 4;

/**
 * PINs are 4–6 digits, exactly 6 for owners, managers and HQ (`senior`). Trivially guessable
 * ones (0000, 1234, 9876…) are rejected because a PIN is the only thing between a lost phone
 * and the day's cash totals.
 */
export function checkPin(pin: string, senior = false): PinProblem | null {
  if (!/^\d{4,6}$/.test(pin)) return 'format';
  if (senior && pin.length < SENIOR_PIN_DIGITS) return 'too_short';
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
    case 'too_short':
      return `Owners and managers need a ${SENIOR_PIN_DIGITS}-digit PIN.`;
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
  | 'sellers_changed'
  /** A wash that waited offline kept the price the customer was quoted (from: today's, to: kept). */
  | 'price_kept';

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
 *
 * When the phone also says what its clock read as it sent the request (`clientSentAt`), only
 * the gap between the two is used — both come from the same clock, so a phone set to the wrong
 * day or hour can't move a wash or a payment onto another day: it happened `sent − occurred`
 * before the server received it.
 */
export function resolveOccurredAt(
  occurredAt: string | undefined,
  now: Date = new Date(),
  clientSentAt?: string,
): Date {
  if (!occurredAt) return now;
  const t = new Date(occurredAt);
  if (Number.isNaN(t.getTime())) return now;
  const sent = clientSentAt ? new Date(clientSentAt) : null;
  if (sent && !Number.isNaN(sent.getTime())) {
    const waited = sent.getTime() - t.getTime();
    if (waited <= 0 || waited > MAX_OFFLINE_BACKDATE_MS) return now;
    return new Date(now.getTime() - waited);
  }
  if (t.getTime() > now.getTime()) return now;
  if (now.getTime() - t.getTime() > MAX_OFFLINE_BACKDATE_MS) return now;
  return t;
}
