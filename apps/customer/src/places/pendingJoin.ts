import type { JoinResult } from '../api/types';

/**
 * A new number's join signs them in, which swaps the whole navigator; the result waits here so
 * the signed-in app opens on it ("You're in!") instead of Home.
 */
export interface PendingJoin {
  result: JoinResult;
  placeLabel: string;
}

let pending: PendingJoin | null = null;

export function setPendingJoin(value: PendingJoin) {
  pending = value;
}

/** The waiting result, once. */
export function takePendingJoin(): PendingJoin | null {
  const value = pending;
  pending = null;
  return value;
}
