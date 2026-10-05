import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { errorMessage } from '../api/errors';

interface Remote<T> {
  data: T | null;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** Pull-to-refresh or a reload with data already on screen. */
  refreshing: boolean;
  /** Message fit to show for the last failed load; null after a good one. */
  error: string | null;
  /** What the last failed load threw (to tell, say, an expired ticket apart). */
  failure: unknown;
  reload: () => Promise<void>;
}

/**
 * Loads something from the API for a screen, again each time the screen comes back into view
 * (back from a detail or a form). Data from the last good load stays on screen when a refresh
 * fails. Only for screens inside a navigator. With `pollMs`, it also reloads quietly on that
 * interval while the screen is in view.
 */
export function useRemote<T>(load: () => Promise<T>, options?: { pollMs?: number | null }): Remote<T> {
  const pollMs = options?.pollMs ?? null;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasData = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (silent: boolean) => {
    if (!hasData.current) setLoading(true);
    else if (!silent) setRefreshing(true);
    try {
      const next = await loadRef.current();
      if (!alive.current) return;
      hasData.current = true;
      setData(next);
      setFailure(null);
    } catch (err) {
      if (alive.current) setFailure(err ?? new Error('failed'));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const reload = useCallback(() => run(false), [run]);

  useFocusEffect(
    useCallback(() => {
      void run(true);
    }, [run]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!pollMs) return undefined;
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void run(true);
      }, pollMs);
      return () => clearInterval(timer);
    }, [run, pollMs]),
  );

  return { data, loading, refreshing, error: failure ? errorMessage(failure) : null, failure, reload };
}
