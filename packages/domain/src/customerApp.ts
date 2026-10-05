/**
 * The MANA Car Wash app for signed-in customers: their car's live status, each branch's contact
 * details and opening hours, rating a wash, reporting a problem, and asking to add a vehicle.
 */

// ─── Profile ────────────────────────────────────────────────────────────────

export const CUSTOMER_NAME_MAX = 60;

// ─── Vehicles ───────────────────────────────────────────────────────────────

/** "ap 39 ab 1234" → "AP39AB1234", the shape New Wash stores. */
export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidRegistration(registration: string): boolean {
  return /^[A-Z0-9-]{4,15}$/.test(registration);
}

export const VEHICLE_MAKE_MAX = 40;
/** Waiting on the team at once, per customer and branch — stops a stuck app from flooding staff. */
export const MAX_PENDING_VEHICLE_REQUESTS = 3;

export const VEHICLE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type VehicleRequestStatus = (typeof VEHICLE_REQUEST_STATUSES)[number];

// ─── Ratings ────────────────────────────────────────────────────────────────

/** A paid wash can be rated, or the rating changed, for this long after it was paid. */
export const RATING_WINDOW_DAYS = 14;
export const RATING_COMMENT_MAX = 300;
/** At or above this, the app suggests sharing the review on Google too. */
export const GOOGLE_REVIEW_MIN_STARS = 4;

export const STAR_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

export function canRateWash(input: { status: string; paidAt: Date | null; now: Date }): boolean {
  if (input.status !== 'paid' || !input.paidAt) return false;
  return input.now.getTime() - input.paidAt.getTime() <= RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// ─── Problems ───────────────────────────────────────────────────────────────

export const PROBLEM_KINDS = ['not_clean', 'damage', 'missed_service', 'billing', 'staff', 'other'] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const PROBLEM_KIND_LABELS: Record<ProblemKind, string> = {
  not_clean: 'Not cleaned properly',
  damage: 'Damage or something missing',
  missed_service: 'A service was missed',
  billing: 'Charged wrongly',
  staff: 'Staff behaviour',
  other: 'Something else',
};

export const PROBLEM_DETAILS_MIN = 10;
export const PROBLEM_DETAILS_MAX = 500;
export const PROBLEM_RESOLUTION_MAX = 300;
/** Open reports per customer and branch. */
export const MAX_OPEN_PROBLEMS = 5;

export type ProblemStatus = 'open' | 'resolved';

// ─── Opening hours ──────────────────────────────────────────────────────────

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
  /** Day of the week the branch is closed, or null. */
  weeklyOff: number | null;
}

const IST_OFFSET_MINUTES = 330;

/** The IST weekday and minutes since IST midnight. */
function istClock(now: Date): { day: number; minutes: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return { day: ist.getUTCDay(), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export type OpenState =
  | { kind: 'unknown' }
  | { kind: 'open'; label: string }
  | { kind: 'closed'; label: string };

/** "Open now · till 8 pm" / "Closed · opens 8 am" / "Closed today (Tuesday off)". */
export function openState(hours: OpeningHours, now: Date): OpenState {
  if (!hours.opensAt || !hours.closesAt) return { kind: 'unknown' };
  const { day, minutes } = istClock(now);
  const opens = clockMinutes(hours.opensAt);
  const closes = clockMinutes(hours.closesAt);
  const offToday = hours.weeklyOff === day;
  if (!offToday && minutes >= opens && minutes < closes) {
    return { kind: 'open', label: `Open now · till ${formatClock(hours.closesAt)}` };
  }
  if (!offToday && minutes < opens) return { kind: 'closed', label: `Closed · opens ${formatClock(hours.opensAt)}` };
  const tomorrowOff = hours.weeklyOff === (day + 1) % 7;
  if (offToday && minutes < opens) return { kind: 'closed', label: `Closed today (${WEEKDAY_LABELS[day]} off)` };
  return tomorrowOff
    ? { kind: 'closed', label: `Closed · ${WEEKDAY_LABELS[(day + 1) % 7]} off` }
    : { kind: 'closed', label: `Closed · opens ${formatClock(hours.opensAt)} tomorrow` };
}

/** "8 am – 8 pm · closed Tuesdays". */
export function hoursSummary(hours: OpeningHours): string | null {
  if (!hours.opensAt || !hours.closesAt) return null;
  const range = `${formatClock(hours.opensAt)} – ${formatClock(hours.closesAt)}`;
  return hours.weeklyOff == null ? `${range} · every day` : `${range} · closed ${WEEKDAY_LABELS[hours.weeklyOff]}s`;
}

// ─── Live status ────────────────────────────────────────────────────────────

/** A wash left on the board longer than this isn't "today's" any more, so the app stops showing it live. */
export const LIVE_WASH_HOURS = 36;

export type LiveStatus = 'waiting' | 'washing' | 'ready';

export function liveStatusText(status: LiveStatus, ahead: number): { title: string; body: string } {
  switch (status) {
    case 'waiting':
      return {
        title: 'In the queue',
        body:
          ahead === 0
            ? 'Your vehicle is next.'
            : `${ahead} ${ahead === 1 ? 'vehicle' : 'vehicles'} ahead of yours.`,
      };
    case 'washing':
      return { title: 'Being washed', body: 'Our team is working on your vehicle now.' };
    case 'ready':
      return { title: 'Ready for pickup', body: 'Your vehicle is clean and waiting for you.' };
  }
}

// ─── Referrals ──────────────────────────────────────────────────────────────

/** What the friend and the customer get, in words — the percentages come from `pickCouponPercent`. */
export const REFERRAL_OFFER_TEXT = '5–10% off';

export function referralShareMessage(input: { phone: string; city: string | null }): string {
  const where = input.city ? `MANA Car Wash, ${input.city}` : 'MANA Car Wash';
  return (
    `I get my vehicle washed at ${where}. ` +
    `Give my number ${input.phone} at the counter on your first visit and you get ${REFERRAL_OFFER_TEXT} your wash.`
  );
}
