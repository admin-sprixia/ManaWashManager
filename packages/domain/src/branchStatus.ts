/**
 * Whether a branch may work, set only by Mana Wash HQ. The software itself is part of the
 * franchise, so nothing here depends on payments.
 *
 * - active: everything works.
 * - paused: nobody starts a new wash and nothing else changes, but washes already open can be
 *   finished and paid, the cash counter closed, and everything viewed. Customers can't book it.
 * - closed: nobody can sign in to it. Its records are kept for HQ.
 */
export const BRANCH_STATUSES = ['active', 'paused', 'closed'] as const;

export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const BRANCH_STATUS_LABEL: Record<BranchStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  closed: 'Closed',
};

/** HQ says why a branch was paused or closed; the team sees it. */
export const BRANCH_STATUS_REASON_MIN = 3;
export const BRANCH_STATUS_REASON_MAX = 200;

export function branchPausedMessage(reason: string | null): string {
  const why = reason ? ` Reason: ${reason}` : '';
  return `Mana Wash HQ has paused this branch. You can finish and take payment for washes already started, but not start new ones.${why}`;
}

export function branchClosedMessage(reason: string | null): string {
  const why = reason ? ` Reason: ${reason}` : '';
  return `Mana Wash HQ has closed this branch, so it can’t be used any more.${why}`;
}
