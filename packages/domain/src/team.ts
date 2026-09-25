import type { JobStatus, PaymentMethod } from './types';

export type UserRole = 'owner' | 'staff';

export const USER_ROLES: readonly UserRole[] = ['owner', 'staff'];

/** Wrong-PIN attempts allowed before the account's PIN sign-in is locked. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

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
  | 'payment_method_changed';

export type ExpenseCategory =
  | 'chemicals'
  | 'labour'
  | 'electricity'
  | 'water'
  | 'maintenance'
  | 'other';

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
