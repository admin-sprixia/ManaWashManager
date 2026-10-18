import { WEEKDAY_SHORT } from '@mana/domain';
import { placeTitle } from '../shared';
import { time12 } from './options';
import type { ReviewContext } from './types';

/** Roughly what one washer gets through in a morning ("two washers do about 8–10 cars"). */
export const CARS_PER_WASHER = 5;
/** Two wash days closer than this, for the same washer, count as a clash. */
const CLASH_MINUTES = 120;

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
};

export interface Clash {
  washer: string;
  place: string;
  day: number;
  time: string;
}

export interface TeamInsight {
  washers: number;
  /** What the picked team can wash in one morning. */
  canWash: number;
  /** Vehicles expected on one wash day: the daily limit, else what the visit counted (bikes count half). */
  expected: number | null;
  short: boolean;
  clashes: Clash[];
  /** A one-line clash description for each, "Ravi is at Sai Enclave on Sun at 7:00 AM". */
  lines: string[];
}

/** Whether the picked team can handle the community, and anyone booked somewhere else at the same time. */
export function teamInsights(ctx: ReviewContext): TeamInsight {
  const { teamIds, days, time, capacity } = ctx.settings;
  const washers = teamIds.length;
  const canWash = washers * CARS_PER_WASHER;
  const { cars, bikes } = ctx.place.setup.inspection;
  const counted = cars != null || bikes != null ? (cars ?? 0) + Math.ceil((bikes ?? 0) / 2) : null;
  const limit = capacity.trim() ? Number(capacity) : null;
  const expected = limit != null && Number.isFinite(limit) ? (counted != null ? Math.min(limit, counted) : limit) : counted;

  const names = new Map(ctx.users.map((u) => [u.id, u.name.split(' ')[0]!]));
  const mine = new Set(days.map(Number));
  const clashes: Clash[] = [];
  for (const other of ctx.others) {
    if (other.id === ctx.placeId || other.stage !== 'live' || other.status !== 'active') continue;
    if (Math.abs(minutes(other.washTime) - minutes(time)) >= CLASH_MINUTES) continue;
    const sharedDays = other.washDays.filter((d) => mine.has(d));
    if (!sharedDays.length) continue;
    for (const member of other.setup.team) {
      if (!teamIds.includes(member.id)) continue;
      clashes.push({ washer: names.get(member.id) ?? member.name, place: placeTitle(other), day: sharedDays[0]!, time: other.washTime });
    }
  }

  return {
    washers,
    canWash,
    expected,
    short: washers > 0 && expected != null && expected > canWash,
    clashes,
    lines: clashes.map((c) => `${c.washer} is at ${c.place} on ${WEEKDAY_SHORT[c.day]} at ${time12(c.time)}`),
  };
}
