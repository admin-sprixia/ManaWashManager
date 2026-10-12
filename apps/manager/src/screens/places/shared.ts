import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { InferResponseType } from 'hono/client';
import { istDay, PLACE_TYPE_LABEL, type OrderPhase, type PlaceType } from '@mana/domain';
import { showToast, type PillTone } from '@mana/ui';
import { api, apiErrorMessage, type ApiResponse } from '../../api/client';
import { NetworkError } from '../../api/network';

export type PlaceListItem = InferResponseType<(typeof api)['places']['$get'], 200>['places'][number];
export type PlaceDetail = InferResponseType<(typeof api)['places'][':id']['$get'], 200>;
export type PlaceMember = InferResponseType<(typeof api)['places'][':id']['members']['$get'], 200>['members'][number];
export type WashDay = InferResponseType<(typeof api)['places'][':id']['day'][':day']['$get'], 200>;
export type WashDayRow = WashDay['rows'][number];
export type Demand = InferResponseType<(typeof api)['places']['demand']['$get'], 200>;
export type StaffMenu = InferResponseType<(typeof api)['places']['menu']['$get'], 200>;
export type StaffJoin = InferResponseType<(typeof api)['places'][':id']['members']['$post'], 201>;
export type Overview = InferResponseType<(typeof api)['places']['overview']['$get'], 200>;
export type OverviewPlace = Overview['days'][number]['places'][number];
export type TeamUser = InferResponseType<(typeof api)['places']['team']['$get'], 200>['users'][number];
export type PlaceSetup = PlaceDetail['place']['setup'];

export const failure = (e: unknown) => (e instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.');

/**
 * Something from the API for a screen: loaded whenever the screen comes into view, kept on
 * screen when a reload fails. `run` sends a change, reloads, and resolves with an error message
 * (or null once it's saved).
 */
export function useApiData<T>(fetcher: () => Promise<ApiResponse>, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const res = await fetcherRef.current();
      if (!res.ok) {
        setError(await apiErrorMessage(res, fallback));
        return;
      }
      setData((await res.json()) as T);
      setError(null);
    } catch (e) {
      setError(failure(e));
    }
  }, [fallback]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = useCallback(
    async (call: () => Promise<ApiResponse>, done?: string): Promise<string | null> => {
      try {
        const res = await call();
        if (!res.ok) return apiErrorMessage(res, 'Couldn’t save that.');
        await load();
        if (done) showToast(done, 'success');
        return null;
      } catch (e) {
        return failure(e);
      }
    },
    [load],
  );

  return { data, error, refreshing, load, refresh, run };
}

/** Shows a change's error as a toast; for actions without a form to show it in. */
export async function toastOnError(result: Promise<string | null>): Promise<boolean> {
  const message = await result;
  if (message) showToast(message, 'error');
  return message == null;
}

export function placeTitle(p: { name: string | null; label: string }): string {
  return p.name ?? p.label;
}

export function placeKindLine(p: { type: PlaceType; name: string | null; label: string }): string {
  return p.name ? p.label : PLACE_TYPE_LABEL[p.type];
}

/** How the team reads an order's state on the list. */
export const PHASE_STAFF_LABEL: Record<OrderPhase, string> = {
  waitlist: 'Waiting list',
  awaiting_payment: 'Not paid',
  active: 'Paid',
  payment_due: 'Part due',
  paused_unpaid: 'Stopped · unpaid',
  on_pause: 'On pause',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export const PHASE_STAFF_TONE: Record<OrderPhase, PillTone> = {
  waitlist: 'slate',
  awaiting_payment: 'danger',
  active: 'teal',
  payment_due: 'amber',
  paused_unpaid: 'danger',
  on_pause: 'slate',
  ended: 'slate',
  cancelled: 'slate',
};

/** Today as the API takes it, in India: "2026-10-06". */
export const istToday = () => istDay(new Date());
