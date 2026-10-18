import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { InferResponseType } from 'hono/client';
import { api } from '../../api/client';

type Overview = InferResponseType<(typeof api)['places']['overview']['$get'], 200>;
export type CommunityTodayPlace = Overview['days'][number]['places'][number];

/**
 * Today's community washes and the owner's approvals, for the home hero and the Communities tab.
 * Refreshed whenever the board comes into view. Failures stay quiet: the board works offline.
 */
export function useCommunityToday() {
  const [data, setData] = useState<Overview | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.places.overview.$get({ query: { days: '1' } });
      if (res.ok && alive.current) setData(await res.json());
    } catch {
      // Offline: keep what's on screen.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  const places = data?.days[0]?.places ?? [];
  return {
    places,
    review: data?.review ?? 0,
    due: places.reduce((n, p) => n + p.due, 0),
    done: places.reduce((n, p) => n + p.done, 0),
    unpaid: places.reduce((n, p) => n + p.unpaid, 0),
    far: places.reduce((n, p) => n + p.far, 0),
    refresh: load,
  };
}
