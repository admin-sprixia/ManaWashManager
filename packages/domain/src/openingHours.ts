/** A branch's opening hours and weekly days off. */

/** Sunday = 0 … Saturday = 6, as `Date.getUTCDay()`. */
export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidClock(value: string): boolean {
  return CLOCK.test(value);
}

/** "08:00" → 480. */
export function clockMinutes(value: string): number {
  const m = CLOCK.exec(value);
  if (!m) throw new Error(`Not a time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "08:00" → "8 am", "20:30" → "8:30 pm", "12:00" → "12 pm". */
export function formatClock(value: string): string {
  const minutes = clockMinutes(value);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

export interface OpeningHours {
  opensAt: string | null;
  closesAt: string | null;
  /** The first day of the week the branch is closed, or null (kept for older apps). */
  weeklyOff: number | null;
  /** Every day of the week it's closed (Sunday = 0); when missing, just `weeklyOff`. */
  weeklyOffDays?: number[];
}

/** A branch is open at least one day a week. */
export const MAX_WEEKLY_OFF_DAYS = 6;

/** Its closed days, sorted, from either field. */
export function offDaysOf(hours: Pick<OpeningHours, 'weeklyOff' | 'weeklyOffDays'>): number[] {
  const days = hours.weeklyOffDays ?? (hours.weeklyOff != null ? [hours.weeklyOff] : []);
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

/** "0,6" (as stored) → [0, 6]; anything else is dropped. */
export function parseOffDays(text: string | null | undefined): number[] {
  if (!text) return [];
  return offDaysOf({ weeklyOff: null, weeklyOffDays: text.split(',').map((t) => Number(t.trim())) });
}

/** [6, 0] → "0,6" (as stored), or null for none. */
export function formatOffDays(days: number[]): string | null {
  const sorted = offDaysOf({ weeklyOff: null, weeklyOffDays: days });
  return sorted.length ? sorted.join(',') : null;
}

/** "8 am – 8 pm · closed Tuesdays" / "… · closed Saturdays and Sundays". */
export function hoursSummary(hours: OpeningHours): string | null {
  if (!hours.opensAt || !hours.closesAt) return null;
  const range = `${formatClock(hours.opensAt)} – ${formatClock(hours.closesAt)}`;
  const off = offDaysOf(hours).map((d) => `${WEEKDAY_LABELS[d]}s`);
  if (!off.length) return `${range} · every day`;
  const days = off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} and ${off[off.length - 1]}`;
  return `${range} · closed ${days}`;
}
