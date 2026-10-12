import { formatClock } from './customerApp';
import { isClockTime, sortWeekdays, WEEKDAY_SHORT } from './places';

/**
 * Setting a community up. A teammate visits, inspects it and saves a draft (location from their
 * phone, photos, a checklist, the secretary's number, the days and times residents asked for);
 * they send it for review; the owner picks the days, time and team and makes it live. Nobody can
 * join or see a community until it is live.
 */

export type PlaceStage = 'draft' | 'review' | 'live';
export const PLACE_STAGES: readonly PlaceStage[] = ['draft', 'review', 'live'];

export type PlacePhotoKind = 'gate' | 'parking' | 'water' | 'building' | 'other';
export const PLACE_PHOTO_KINDS: readonly PlacePhotoKind[] = ['gate', 'parking', 'water', 'building', 'other'];
export const PLACE_PHOTO_KIND_LABEL: Readonly<Record<PlacePhotoKind, string>> = {
  gate: 'Gate',
  parking: 'Parking',
  water: 'Water point',
  building: 'Building',
  other: 'Other',
};
export const MAX_PLACE_PHOTOS = 12;

export const PLACE_NOTES_MAX = 500;
export const CONTACT_NAME_MAX = 60;
export const REVIEW_NOTE_MAX = 300;
export const MAX_PROPOSED_SLOTS = 3;
export const MAX_PLACE_TEAM = 20;
export const INSPECTION_COUNT_MAX = 999;
/** Requests from one spot that make it worth visiting to start a community there. */
export const START_COMMUNITY_AT = 5;

// ─── The inspection checklist ────────────────────────────────────────────────

export type WaterAnswer = 'yes' | 'no' | 'bring';
export type PowerAnswer = 'yes' | 'no';
export type ParkingKind = 'basement' | 'open' | 'street' | 'mixed';
export type SpaceAnswer = 'good' | 'tight' | 'no';
export type PermissionAnswer = 'yes' | 'pending' | 'no';
export type BestTime = 'early' | 'morning' | 'evening';

/** What the visit found. Every answer is optional while it's a draft. */
export interface Inspection {
  water?: WaterAnswer;
  power?: PowerAnswer;
  parking?: ParkingKind;
  space?: SpaceAnswer;
  permission?: PermissionAnswer;
  cars?: number;
  bikes?: number;
  bestTime?: BestTime;
}

export const WATER_LABEL: Readonly<Record<WaterAnswer, string>> = { yes: 'Tap we can use', no: 'No water', bring: 'We bring our own' };
export const POWER_LABEL: Readonly<Record<PowerAnswer, string>> = { yes: 'Power point', no: 'No power' };
export const PARKING_LABEL: Readonly<Record<ParkingKind, string>> = { basement: 'Basement', open: 'Open parking', street: 'On the street', mixed: 'Mixed' };
export const SPACE_LABEL: Readonly<Record<SpaceAnswer, string>> = { good: 'Room to wash', tight: 'Tight', no: 'No room' };
export const PERMISSION_LABEL: Readonly<Record<PermissionAnswer, string>> = { yes: 'Society agreed', pending: 'Asking the society', no: 'Society said no' };
export const BEST_TIME_LABEL: Readonly<Record<BestTime, string>> = { early: 'Before 7 am', morning: '7 to 10 am', evening: 'Evening' };

const pick = <T extends string>(value: unknown, allowed: Readonly<Record<T, string>>): T | undefined =>
  typeof value === 'string' && value in allowed ? (value as T) : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= INSPECTION_COUNT_MAX ? value : undefined;

/** Keeps only answers it knows; anything else (or bad JSON) is dropped. */
export function cleanInspection(raw: unknown): Inspection {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Inspection = {
    water: pick(r.water, WATER_LABEL),
    power: pick(r.power, POWER_LABEL),
    parking: pick(r.parking, PARKING_LABEL),
    space: pick(r.space, SPACE_LABEL),
    permission: pick(r.permission, PERMISSION_LABEL),
    cars: count(r.cars),
    bikes: count(r.bikes),
    bestTime: pick(r.bestTime, BEST_TIME_LABEL),
  };
  for (const key of Object.keys(out) as (keyof Inspection)[]) if (out[key] === undefined) delete out[key];
  return out;
}

export function parseInspection(text: string | null | undefined): Inspection {
  if (!text) return {};
  try {
    return cleanInspection(JSON.parse(text));
  } catch {
    return {};
  }
}

export function formatInspection(inspection: Inspection): string | null {
  const clean = cleanInspection(inspection);
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** Answers that make the owner look twice before approving. */
export function inspectionWarnings(i: Inspection): string[] {
  return [
    i.permission === 'no' ? 'The society said no' : null,
    i.permission === 'pending' ? 'The society hasn’t agreed yet' : null,
    i.water === 'no' ? 'No water there — the team must bring it' : null,
    i.space === 'no' ? 'No room to wash' : null,
    i.space === 'tight' ? 'Tight space to wash' : null,
  ].filter((w): w is string => w != null);
}

// ─── Days and times residents asked for ──────────────────────────────────────

export interface ProposedSlot {
  days: number[];
  time: string;
}

export function cleanSlots(raw: unknown): ProposedSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposedSlot[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const { days, time } = s as { days?: unknown; time?: unknown };
    if (typeof time !== 'string' || !isClockTime(time) || !Array.isArray(days)) continue;
    const valid = sortWeekdays(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6));
    if (valid.length) out.push({ days: valid, time });
    if (out.length === MAX_PROPOSED_SLOTS) break;
  }
  return out;
}

export function parseSlots(text: string | null | undefined): ProposedSlot[] {
  if (!text) return [];
  try {
    return cleanSlots(JSON.parse(text));
  } catch {
    return [];
  }
}

export function formatSlots(slots: readonly ProposedSlot[]): string | null {
  const clean = cleanSlots(slots);
  return clean.length ? JSON.stringify(clean) : null;
}

/** "Wed, Fri, Sun · 6:30 am". */
export function describeSlot(slot: ProposedSlot): string {
  return `${sortWeekdays(slot.days)
    .map((d) => WEEKDAY_SHORT[d])
    .join(', ')} · ${formatClock(slot.time)}`;
}

// ─── The team that goes there ────────────────────────────────────────────────

export function parseTeam(text: string | null | undefined): string[] {
  return [...new Set((text ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_PLACE_TEAM);
}

export function formatTeam(ids: readonly string[]): string | null {
  const clean = parseTeam(ids.join(','));
  return clean.length ? clean.join(',') : null;
}

// ─── Ready to send for review? ───────────────────────────────────────────────

export interface DraftCheck {
  photos: number;
  inspection: Inspection;
  slots: readonly ProposedSlot[];
  contactPhone: string | null;
}

/** What's still missing before a draft can go to the owner; empty when it's ready. */
export function missingForReview(d: DraftCheck): string[] {
  return [
    d.photos === 0 ? 'At least one photo' : null,
    d.inspection.permission == null ? 'Did the society agree?' : null,
    d.inspection.water == null ? 'Water' : null,
    d.inspection.parking == null ? 'Parking' : null,
    d.inspection.cars == null && d.inspection.bikes == null ? 'About how many vehicles' : null,
    d.contactPhone == null ? 'Secretary or watchman’s number' : null,
    d.slots.length === 0 ? 'Days and time residents want' : null,
  ].filter((m): m is string => m != null);
}
