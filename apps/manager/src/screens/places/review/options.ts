import { sortWeekdays, WEEKDAY_NAMES, WEEKDAY_SHORT, type ProposedSlot } from '@mana/domain';
import type { SelectOption } from '../../../components/SelectField';

export type Meridiem = 'AM' | 'PM';

/** Washes start no earlier than 5:00 AM and no later than 10:00 PM, on the half hour. */
const FIRST = 5 * 60;
const LAST = 22 * 60;
const STEP = 30;

const pad = (n: number) => String(n).padStart(2, '0');
const toClock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
};

export const meridiemOf = (t: string): Meridiem => (minutesOf(t) < 12 * 60 ? 'AM' : 'PM');

/** "07:00" → "7:00" (the clock face, without AM/PM). */
export function clockFace(t: string): string {
  const mins = minutesOf(t);
  const h = Math.floor(mins / 60) % 12 || 12;
  return `${h}:${pad(mins % 60)}`;
}

/** "07:00" → "7:00 AM", "18:30" → "6:30 PM". */
export function time12(t: string): string {
  return `${clockFace(t)} ${meridiemOf(t)}`;
}

/**
 * The clock numbers for one half of the day, inside the wash hours: 5:00–11:30 for AM, 12:00–10:00
 * for PM. A saved time off the half hour ("06:15") stays in its list.
 */
export function clockOptions(meridiem: Meridiem, current?: string | null): SelectOption<string>[] {
  const from = meridiem === 'AM' ? FIRST : 12 * 60;
  const to = meridiem === 'AM' ? 12 * 60 - STEP : LAST;
  const times: string[] = [];
  for (let m = from; m <= to; m += STEP) times.push(toClock(m));
  if (current && meridiemOf(current) === meridiem && !times.includes(current)) {
    times.push(current);
    times.sort();
  }
  return times.map((t) => ({ value: t, label: clockFace(t) }));
}

/** The same clock time in the other half of the day, kept inside the wash hours. */
export function switchMeridiem(t: string, to: Meridiem): string {
  if (meridiemOf(t) === to) return t;
  const moved = minutesOf(t) + (to === 'PM' ? 12 * 60 : -12 * 60);
  return toClock(Math.min(LAST, Math.max(FIRST, moved)));
}

/** Monday first, as people plan a week. Values are the weekday numbers as text (0 = Sunday). */
export const DAY_SELECT_OPTIONS: SelectOption<string>[] = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
  value: String(d),
  label: WEEKDAY_NAMES[d]!,
}));

/** "Every day", "Weekdays", "Weekends", or "Mon, Wed, Fri". */
export function daysSummary(days: readonly string[]): string {
  const sorted = sortWeekdays(days.map(Number));
  const key = sorted.join();
  if (sorted.length === 7) return 'Every day';
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '6,0') return 'Weekends';
  if (sorted.length === 1) return WEEKDAY_NAMES[sorted[0]!]!;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
}

/** "Sun, Wed · 7:00 AM" for the picked days and time. */
export function scheduleLine(days: readonly string[], time: string): string {
  return days.length ? `${daysSummary(days)} · ${time12(time)}` : 'No days picked';
}

/** What the owner confirms before a community goes live. Kept on the phone; ticked again each review. */
export const OWNER_CHECKS = [
  { key: 'contact', label: 'Spoke to the secretary or watchman', caption: 'They know the team is coming and when.' },
  { key: 'permission', label: 'The society has agreed', caption: 'In writing, or from someone who can say yes.' },
  { key: 'water', label: 'Water, power, parking and space will work', caption: 'Checked the photos of each on their tabs.' },
  { key: 'team', label: 'The team can make the days and time', caption: 'No clash with their other wash days.' },
] as const;

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

/** "1st choice", "2nd choice" … for the days residents asked for, in order. */
export const choiceLabel = (index: number) => `${ORDINALS[index] ?? `${index + 1}th`} choice`;

/** A residents' choice in the same words: "Sat, Sun · 7:00 AM". */
export function slotLine(slot: ProposedSlot): string {
  return scheduleLine(slot.days.map(String), slot.time);
}
