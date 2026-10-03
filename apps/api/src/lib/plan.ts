import type { Context, Next } from 'hono';
import { billingRepo, userRepo, type DbClient } from '@mana/db';
import {
  isPaidPro,
  planRequiredMessage,
  planStatus,
  SEAT_LOCKED_MESSAGE,
  staffLimitMessage,
  WASH_LIMIT_OFFLINE_GRACE,
  washLimitMessage,
  type PlanStatus,
  type ProFeature,
} from '@mana/domain';
import { startOfIstDaysAgo, startOfIstMonth } from './istDate';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    /** The signed-in shop's plan, worked out once per request by requireAuth. */
    plan: PlanStatus;
  }
}

/** The shop's plan right now. A missing shop row reads as Free rather than failing open. */
export async function loadPlan(db: DbClient, shopId: string, now = new Date()): Promise<PlanStatus> {
  const row = await billingRepo.findPlan(db, shopId);
  return planStatus(row ?? { plan: 'free', trialEndsAt: null, paidUntil: null }, now);
}

/**
 * True when this person owns another shop that's on paid Pro — what earns a shop the branch
 * price. `platform` must be the unscoped client, since it reads the owner's other shops.
 */
export async function ownsOtherPaidProShop(
  platform: DbClient,
  phone: string,
  shopId: string,
  now = new Date(),
): Promise<boolean> {
  const others = (await userRepo.listByPhone(platform, phone)).filter(
    (r) => r.active && r.role === 'owner' && r.shopId !== shopId,
  );
  const plans = await Promise.all(others.map((r) => loadPlan(platform, r.shopId, now)));
  return plans.some(isPaidPro);
}

/** The owner's seat plus the plan's staff seats. A second owner takes one of the staff seats. */
export const teamSeats = (plan: PlanStatus) => 1 + plan.limits.staff;

/**
 * True when a staff member is beyond the plan's seats. Seats go to owners, then the
 * longest-serving staff, so dropping to Free never locks out the person who's been there longest
 * and the order can't be gamed from the phone. Owners are never locked.
 */
export async function seatLocked(db: DbClient, userId: string, plan: PlanStatus): Promise<boolean> {
  return seatIsLocked(await billingRepo.listSeatOrder(db), userId, plan);
}

export function seatIsLocked(order: { id: string }[], userId: string, plan: PlanStatus): boolean {
  const index = order.findIndex((u) => u.id === userId);
  return index === -1 || index >= teamSeats(plan);
}

export const seatLockedBody = { error: 'plan_seat_locked' as const, message: SEAT_LOCKED_MESSAGE };

/** Refuses another active member once every seat is taken; null when there's room. */
export async function teamFullProblem(db: DbClient, plan: PlanStatus) {
  if ((await billingRepo.countActiveMembers(db)) < teamSeats(plan)) return null;
  return {
    error: 'plan_staff_limit' as const,
    message: staffLimitMessage(plan.tier, plan.limits.staff),
  };
}

/** Blocks a Pro feature on Free with 402 and a message the app shows next to its upgrade button. */
export function requirePro(feature: ProFeature) {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    if (c.get('plan').tier !== 'pro') {
      return c.json({ error: 'plan_required' as const, feature, message: planRequiredMessage(feature) }, 402);
    }
    await next();
  };
}

/** A wash recorded more than this long before it reached the server was queued offline. */
const OFFLINE_AFTER_MS = 2 * 60 * 1000;

/**
 * Free plan: at most `washesPerMonth` washes started per IST month. A wash entered live is refused
 * once the month's are used up (the app shows the upgrade screen first). One that was entered
 * offline — the car was already washed before the phone knew — still syncs, up to a small
 * cushion, so a busy offline morning isn't lost.
 */
export async function washLimitProblem(
  db: DbClient,
  plan: PlanStatus,
  occurredAt: Date,
  now = new Date(),
): Promise<{ error: 'plan_wash_limit'; message: string; limit: number; used: number } | null> {
  const limit = plan.limits.washesPerMonth;
  if (limit == null) return null;
  const used = await billingRepo.countWashesSince(db, startOfIstMonth(now));
  const offline = now.getTime() - occurredAt.getTime() > OFFLINE_AFTER_MS;
  const allowed = offline ? limit + WASH_LIMIT_OFFLINE_GRACE : limit;
  if (used < allowed) return null;
  return { error: 'plan_wash_limit', message: washLimitMessage(limit), limit, used };
}

/** Free plan reports reach back `reportDays` days counting today; null when the window is fine. */
export function reportWindowProblem(plan: PlanStatus, from: Date, now = new Date()) {
  const days = plan.limits.reportDays;
  if (days == null || from.getTime() >= startOfIstDaysAgo(days - 1, now).getTime()) return null;
  return {
    error: 'plan_required' as const,
    feature: 'fullReports' as const,
    message: planRequiredMessage('fullReports'),
  };
}
