import { distanceKm, type GeoPoint } from './serviceArea';

/**
 * Places: a building, gated colony or street where a branch's team washes on fixed days. People
 * there join as members (from the QR poster, a neighbour's link, the app, or the team), each with
 * their flat or house and vehicles. Days are IST calendar days written "YYYY-MM-DD".
 */

export type PlaceType = 'building' | 'colony' | 'street';
export const PLACE_TYPES: readonly PlaceType[] = ['building', 'colony', 'street'];
export const PLACE_TYPE_LABEL: Readonly<Record<PlaceType, string>> = {
  building: 'Apartment / building',
  colony: 'Gated colony',
  street: 'Street',
};

export type PlaceStatus = 'active' | 'paused' | 'closed';
export type MemberStatus = 'pending' | 'active' | 'left' | 'removed';
export type JoinedVia = 'qr' | 'link' | 'app' | 'staff';
export const JOINED_VIA: readonly JoinedVia[] = ['qr', 'link', 'app', 'staff'];
/** Why the team should look at a member: they confirm, or simply check. */
export type MemberCheck = 'far_away' | 'needs_approval' | 'unit_taken' | 'not_found';

export const PLACE_NAME_MAX = 80;
export const PLACE_LABEL_MIN = 2;
export const PLACE_LABEL_MAX = 80;
export const UNIT_BLOCK_MAX = 20;
export const UNIT_NUMBER_MAX = 20;
export const UNIT_TEXT_MAX = 40;
export const PARKING_NOTE_MAX = 120;
export const PLACE_CAPACITY_MAX = 500;
/** Units added in one go ("101-150, 201-250"). */
export const MAX_UNITS_PER_ADD = 400;
/** How far around the customer the app looks for served places. */
export const NEARBY_PLACES_KM = 3;
export const NEARBY_PLACES_MAX = 12;

// ─── Codes for QR posters and invite links ───────────────────────────────────

/** No 0/O, 1/I/L: read aloud or typed from a poster without mistakes. */
export const PLACE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PLACE_CODE_LENGTH = 7;

export function isPlaceCode(value: string): boolean {
  return new RegExp(`^[${PLACE_CODE_ALPHABET}]{${PLACE_CODE_LENGTH}}$`).test(value);
}

/** A code from random bytes (one byte per character; the tiny modulo bias doesn't matter here). */
export function placeCodeFrom(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < PLACE_CODE_LENGTH; i++) out += PLACE_CODE_ALPHABET[(bytes[i] ?? 0) % PLACE_CODE_ALPHABET.length];
  return out;
}

// ─── IST calendar days ───────────────────────────────────────────────────────

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isClockTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** The IST calendar day an instant falls on. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysTo(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Sunday = 0 … Saturday = 6. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The instant a day's "HH:MM" IST happens. */
export function istInstant(day: string, time: string): Date {
  return new Date(Date.parse(`${day}T${time}:00Z`) - IST_OFFSET_MS);
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Tue 14 Oct". */
export function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "14 Oct 2026". */
export function formatLongDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "morning" before noon, "afternoon" before 4 pm, else "evening". */
export function partOfDay(time: string): 'morning' | 'afternoon' | 'evening' {
  const h = Number(time.slice(0, 2));
  return h < 12 ? 'morning' : h < 16 ? 'afternoon' : 'evening';
}

// ─── Wash days ───────────────────────────────────────────────────────────────

/** "2,5" → [2, 5]: weekdays, sorted Monday first (the order a week runs in), no repeats. */
export function parseWashDays(text: string | null | undefined): number[] {
  const days = new Set<number>();
  for (const part of (text ?? '').split(',')) {
    const n = Number(part.trim());
    if (part.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 6) days.add(n);
  }
  return sortWeekdays([...days]);
}

/** Monday first, Sunday last. */
export function sortWeekdays(days: readonly number[]): number[] {
  const rank = (d: number) => (d + 6) % 7;
  return [...new Set(days)].sort((a, b) => rank(a) - rank(b));
}

export function formatWashDays(days: readonly number[]): string {
  return sortWeekdays(days).join(',');
}

/** "Tuesdays", "Tuesdays and Fridays", "Mon, Wed and Fri". */
export function describeWashDays(days: readonly number[]): string {
  const sorted = sortWeekdays(days);
  if (sorted.length === 0) return 'No wash days';
  if (sorted.length <= 2) return sorted.map((d) => `${WEEKDAY_NAMES[d]}s`).join(' and ');
  const names = sorted.map((d) => WEEKDAY_SHORT[d]);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Monday of the week a day is in. */
function weekStart(day: string): string {
  return addDaysTo(day, -((weekdayOf(day) + 6) % 7));
}

/**
 * A vehicle on a plan is washed on the first `perWeek` of the place's wash days each week (a
 * weekly plan at a place washing Tuesdays and Fridays is washed on Tuesdays).
 */
export function isSlotDay(washDays: readonly number[], perWeek: number, day: string): boolean {
  const sorted = sortWeekdays(washDays);
  const index = sorted.indexOf(weekdayOf(day));
  return index >= 0 && index < Math.max(1, perWeek);
}

/** The place's wash days from `from` (inclusive), up to `count` of them. */
export function nextWashDays(washDays: readonly number[], from: string, count: number): string[] {
  const out: string[] = [];
  if (!washDays.length) return out;
  for (let day = from; out.length < count && dayDiff(from, day) < 7 * (count + 1); day = addDaysTo(day, 1)) {
    if (washDays.includes(weekdayOf(day))) out.push(day);
  }
  return out;
}

export interface DayRange {
  fromOn: string;
  toOn: string;
}

export const inRange = (day: string, r: DayRange) => day >= r.fromOn && day <= r.toOn;

export interface ScheduleInput {
  washDays: readonly number[];
  perWeek: number;
  /** Nothing before this day (the first wash, once paid). */
  startsOn: string;
  /** Washes still to give. */
  remaining: number;
  /** Days the customer skipped, or already recorded (done, not found…). */
  taken?: ReadonlySet<string>;
  pauses?: readonly DayRange[];
}

/** Upper bound on how far ahead a schedule looks (a yearly plan plus pauses). */
const SCHEDULE_HORIZON_DAYS = 3 * 366;

/** The next wash days for one vehicle, from `from` (inclusive), at most `limit`. */
export function upcomingWashes(input: ScheduleInput, from: string, limit: number): string[] {
  const out: string[] = [];
  const want = Math.min(limit, input.remaining);
  if (want <= 0 || !input.washDays.length) return out;
  const start = from > input.startsOn ? from : input.startsOn;
  for (let day = start, n = 0; out.length < want && n < SCHEDULE_HORIZON_DAYS; day = addDaysTo(day, 1), n++) {
    if (!isSlotDay(input.washDays, input.perWeek, day)) continue;
    if (input.taken?.has(day)) continue;
    if (input.pauses?.some((p) => inRange(day, p))) continue;
    out.push(day);
  }
  return out;
}

/** Is this vehicle due on `day`? */
export function isDueOn(input: ScheduleInput, day: string): boolean {
  return upcomingWashes(input, day, 1)[0] === day;
}

/** When the last wash should happen, at today's pace; null when nothing is left. */
export function predictedLastWash(input: ScheduleInput, from: string): string | null {
  const days = upcomingWashes(input, from, input.remaining);
  return days.length === input.remaining && days.length ? days[days.length - 1]! : null;
}

/** Weeks start on Monday; exported for the wash-day list's grouping. */
export { weekStart };

// ─── Joining ─────────────────────────────────────────────────────────────────

export const distanceMeters = (a: GeoPoint, b: GeoPoint) => Math.round(distanceKm(a, b) * 1000);

/** "Call me back" requests this close together count as one place's interest. */
export const INTEREST_RADIUS_M = 250;

/**
 * Groups points that lie within `radiusM` of a group's first point, biggest group first (ties:
 * the order the points came in). Greedy and good enough for a branch's few hundred requests.
 */
export function clusterPoints<T extends GeoPoint>(points: readonly T[], radiusM: number): { center: GeoPoint; items: T[] }[] {
  const groups: { center: GeoPoint; items: T[] }[] = [];
  for (const p of points) {
    const near = groups.find((g) => distanceMeters(g.center, p) <= radiusM);
    if (near) near.items.push(p);
    else groups.push({ center: { latitude: p.latitude, longitude: p.longitude }, items: [p] });
  }
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.items.length - a.g.items.length || a.i - b.i)
    .map(({ g }) => g);
}

export interface JoinCheckInput {
  /** From the place's pin; null when the customer didn't share their location. */
  distanceM: number | null;
  atPlaceMeters: number;
  needsApproval: boolean;
  /** Someone else is already a member for this flat or house. */
  unitTaken: boolean;
  /** The team added them at the place. */
  byStaff: boolean;
}

/**
 * Members at the place (or added by the team there) are in at once; anyone else waits for the
 * team to confirm. A flat someone already uses never stops a join, it only asks the team to check.
 */
export function joinDecision(input: JoinCheckInput): { status: 'active' | 'pending'; checks: MemberCheck[] } {
  const checks: MemberCheck[] = [];
  if (input.needsApproval) checks.push('needs_approval');
  if (!input.byStaff && (input.distanceM == null || input.distanceM > input.atPlaceMeters)) checks.push('far_away');
  if (input.unitTaken) checks.push('unit_taken');
  // The team adding someone at the door is the confirmation; the flag stays for the record.
  const waits = !input.byStaff && (checks.includes('needs_approval') || checks.includes('far_away'));
  return { status: waits ? 'pending' : 'active', checks };
}

export const MEMBER_CHECK_LABEL: Readonly<Record<MemberCheck, string>> = {
  far_away: 'Joined away from the place',
  needs_approval: 'Society approval needed',
  unit_taken: 'Flat already has a member',
  not_found: 'Vehicle not found on wash day',
};

export function parseMemberChecks(text: string | null | undefined): MemberCheck[] {
  const known = new Set<MemberCheck>(['far_away', 'needs_approval', 'unit_taken', 'not_found']);
  return (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MemberCheck => known.has(s as MemberCheck));
}

// ─── Flats and houses ────────────────────────────────────────────────────────

/** "  b-12 " → "B-12": how flat numbers and blocks are stored and compared. */
export function normalizeUnit(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** "House 14-2", but "H.No 14-2" / "Flat 204" as typed, so the word isn't doubled. */
export function unitTitle(noun: string, unit: string): string {
  const u = unit.trim();
  return /^((h|d|door|plot)\.?\s*no\b|(flat|house|plot|villa)\b)/i.test(u) ? u : `${noun} ${u}`;
}

/** "Block B · 204", "204". */
export function unitLabel(block: string | null | undefined, number: string): string {
  return block ? `${block} · ${number}` : number;
}

/**
 * "101-110, 201-205, G1" → every flat number. Numeric ranges keep their width ("001-003" →
 * 001, 002, 003). Null when something can't be read or there are too many.
 */
export function parseUnitList(text: string): string[] | null {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const part = normalizeUnit(raw);
    if (!part) continue;
    const range = part.match(/^(\d{1,6})\s*-\s*(\d{1,6})$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from || to - from >= MAX_UNITS_PER_ADD) return null;
      const width = range[1]!.length === range[2]!.length ? range[1]!.length : 0;
      for (let n = from; n <= to; n++) out.push(String(n).padStart(width, '0'));
    } else if (part.length <= UNIT_NUMBER_MAX && /^[A-Z0-9][A-Z0-9 /-]*$/.test(part)) {
      out.push(part);
    } else {
      return null;
    }
    if (out.length > MAX_UNITS_PER_ADD) return null;
  }
  return [...new Set(out)];
}

/** Natural order: 2 before 10, "G1" before "G2". */
export function compareUnits(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}
