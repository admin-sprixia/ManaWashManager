/**
 * Staff commission: a fixed amount per service per vehicle size, set by the owner on the few
 * services worth rewarding (e.g. rust coating). Earned only on paid jobs, by whoever got the
 * customer to take the service — split equally if more than one person did. Washing a car
 * earns nothing by itself; who washed is only recorded.
 */

import type { UserRole } from './team';

export type AttendanceStatus = 'present' | 'half' | 'absent';

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ['present', 'half', 'absent'];

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  half: 'Half day',
  absent: 'Absent',
};

/**
 * Who marks whose attendance: the owner marks everyone, a manager marks staff (the hub team they
 * run). Nobody marks their own day.
 */
export function canMarkAttendance(actor: UserRole, target: UserRole, self: boolean): boolean {
  if (self) return false;
  if (actor === 'owner') return true;
  return actor === 'manager' && target === 'staff';
}

/** Managers mark today and a forgotten yesterday; older days are the owner's to fix. */
export const ATTENDANCE_MANAGER_DAYS = 1;

/** A month with something marked and not a single absence or half day. */
export function noAbsences(statuses: readonly AttendanceStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s === 'present');
}

/** Days worked, counting a half day as 0.5. */
export function daysWorked(statuses: readonly AttendanceStatus[]): number {
  return statuses.reduce((sum, s) => sum + (s === 'present' ? 1 : s === 'half' ? 0.5 : 0), 0);
}

/** A wash is rarely done by more than a handful of people; more is a mis-tap. */
export const MAX_WASHERS_PER_JOB = 4;

/** People who can share one job's commission. */
export const MAX_SELLERS_PER_JOB = 3;

/** ₹10,000 per service — anything above is certainly a typo. */
export const MAX_COMMISSION_PAISE = 10_000 * 100;

/** Total commission a job's lines carry: per-unit rate × quantity, summed. */
export function jobCommission(lines: readonly { commissionAtTime: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.commissionAtTime * l.quantity, 0);
}

/**
 * Splits `total` paise equally. The leftover paise (at most people − 1) go one each to the
 * first people in id order, so the split is deterministic and always adds up to `total`.
 */
export function splitCommission(total: number, userIds: readonly string[]): Map<string, number> {
  const ids = [...new Set(userIds)].sort();
  const shares = new Map<string, number>();
  if (ids.length === 0 || total <= 0) return shares;
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  for (const id of ids) {
    shares.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return shares;
}
