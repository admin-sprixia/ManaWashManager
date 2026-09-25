import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { CacheKeys, readCache, writeCache } from './cache';
import { applyOutbox } from './optimistic';
import { useSync } from './SyncProvider';
import type { BoardJob } from './types';

interface CachedBoard {
  jobs: BoardJob[];
  fetchedAt: number;
}

/**
 * Today's jobs for the board: cached copy first (instant, works offline), then the server,
 * with this phone's unsynced changes overlaid. Re-fetches on focus and whenever the outbox
 * delivers something.
 */
export function useBoardJobs() {
  const { items, version } = useSync();
  const [serverJobs, setServerJobs] = useState<BoardJob[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.jobs.today.$get();
      if (!res.ok) {
        setError(res.status === 401 ? null : `Couldn’t refresh jobs (${res.status}).`);
        return;
      }
      const data = (await res.json()) as unknown as BoardJob[];
      const now = Date.now();
      setServerJobs(data);
      setFetchedAt(now);
      setError(null);
      await writeCache<CachedBoard>(CacheKeys.jobsToday, { jobs: data, fetchedAt: now });
    } catch (e) {
      if (!(e instanceof NetworkError)) setError('Couldn’t refresh jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void readCache<CachedBoard>(CacheKeys.jobsToday).then((cached) => {
      if (cached) {
        setServerJobs((current) => (current.length ? current : cached.jobs));
        setFetchedAt((current) => current ?? cached.fetchedAt);
        setLoading(false);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (version > 0) void refresh();
  }, [version, refresh]);

  const jobs = useMemo(() => applyOutbox(serverJobs, items), [serverJobs, items]);

  return { jobs, loading, error, fetchedAt, refresh };
}
