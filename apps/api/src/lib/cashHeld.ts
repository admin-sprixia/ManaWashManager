import { expenseRepo, jobRepo, opsRepo, type DbClient } from '@mana/db';
import { cashHeld } from '@mana/domain';

/**
 * Doorstep cash each team member holds right now: all they collected, less what their handovers
 * settled and what they spent from it. Only people holding something are in the map.
 */
export async function cashHeldNow(db: DbClient) {
  const [collected, settled, spent] = await Promise.all([
    jobRepo.doorstepCashByCollector(db),
    opsRepo.handoverSettledByCollector(db),
    expenseRepo.heldSpendByUser(db),
  ]);
  const held = new Map<string, number>();
  for (const c of collected) {
    const amount = cashHeld(c.total, (settled.get(c.userId) ?? 0) + (spent.get(c.userId)?.total ?? 0));
    if (amount > 0) held.set(c.userId, amount);
  }
  return held;
}

/**
 * Lock key for one person's held cash. A handover and a spend from it check what they hold and
 * then write, so both run under this lock: two of them at once can't use the same rupees.
 */
export function heldLockKey(shopId: string, userId: string) {
  return `held:${shopId}:${userId}`;
}

export const heldBusy = {
  error: 'busy' as const,
  message: 'Someone is updating this cash right now. Try again in a moment.',
};
