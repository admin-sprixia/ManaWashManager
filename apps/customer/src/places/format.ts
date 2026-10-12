import { describeWashDays, formatDay, partOfDay, type OrderPhase } from '@mana/domain';
import type { PillTone } from '@mana/ui';

/** "Tuesdays and Fridays · 6:30 am". */
export function washDaysLine(washDays: readonly number[], washTime: string): string {
  return `${describeWashDays(washDays)} · ${clock(washTime)}`;
}

/** "06:30" → "6:30 am". */
export function clock(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Tue 14 Oct morning". */
export function washDayLine(day: string, washTime: string): string {
  return `${formatDay(day)} ${partOfDay(washTime)}`;
}

/**
 * The soonest wash still coming on any of these orders, leaving out days the customer skipped.
 * The place's own wash days aren't enough: today stays one of them after the wash is over.
 */
export function nextWashOf(orders: readonly { nextWashes: readonly string[]; skipped: readonly string[] }[]): string | null {
  return orders.flatMap((o) => o.nextWashes.filter((d) => !o.skipped.includes(d))).sort()[0] ?? null;
}

/** A payment deadline as people say it: "Mon 13 Oct, 8 pm". */
export function deadlineLine(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${day}, ${time.replace(':00', '').toLowerCase()}`;
}

/** "120 m" / "1.4 km". */
export function distanceLine(meters: number): string {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const PHASE_LABEL: Record<OrderPhase, string> = {
  waitlist: 'Waiting list',
  awaiting_payment: 'Not paid',
  active: 'Running',
  payment_due: 'Part due',
  paused_unpaid: 'Paused · pay to continue',
  on_pause: 'On pause',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export const PHASE_TONE: Record<OrderPhase, PillTone> = {
  waitlist: 'slate',
  awaiting_payment: 'amber',
  active: 'teal',
  payment_due: 'amber',
  paused_unpaid: 'danger',
  on_pause: 'slate',
  ended: 'slate',
  cancelled: 'slate',
};

/** Phases where the customer has something to pay now. */
export const NEEDS_PAYMENT: ReadonlySet<OrderPhase> = new Set(['awaiting_payment', 'payment_due', 'paused_unpaid']);
