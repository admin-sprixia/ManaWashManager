import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../api/auth';
import { NetworkError } from '../api/network';
import { useSync } from './SyncProvider';
import {
  applyLocalVisit,
  EMPTY_DIRECTORY,
  loadDirectory,
  saveDirectory,
  syncDirectory,
  type DirectoryEntry,
  type DirectorySnapshot,
  type LocalVisit,
} from './directory';

/** Background refresh cadence while the app is open and online. */
const REFRESH_EVERY_MS = 3 * 60_000;
/** Ignore non-forced refresh requests this soon after the last one. */
const MIN_GAP_MS = 20_000;

interface DirectoryContextValue {
  entries: DirectoryEntry[];
  /** False until the saved copy has been read from disk. */
  ready: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  /** Last sync attempt failed for a reason other than being offline. */
  error: string | null;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  recordVisit: (visit: LocalVisit) => void;
}

const DirectoryContext = createContext<DirectoryContextValue | null>(null);

/**
 * The phone's copy of every customer vehicle, for instant New Wash suggestions with or without
 * signal. Kept current by incremental pulls on sign-in, app foreground, reconnect, after any of
 * this phone's changes reach the server, on New Wash open, and every few minutes.
 */
export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { online, version } = useSync();
  const [snapshot, setSnapshot] = useState<DirectorySnapshot>(EMPTY_DIRECTORY);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshotRef = useRef(snapshot);
  const inflight = useRef<Promise<void> | null>(null);
  const lastAttempt = useRef(0);
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const commit = useCallback((next: DirectorySnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    void saveDirectory(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void loadDirectory().then((saved) => {
      if (cancelled) return;
      snapshotRef.current = saved;
      setSnapshot(saved);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!userId || !ready) return;
      if (inflight.current) return inflight.current;
      if (!force && Date.now() - lastAttempt.current < MIN_GAP_MS) return;
      lastAttempt.current = Date.now();

      const startedFor = userId;
      const run = (async () => {
        setSyncing(true);
        try {
          const next = await syncDirectory(snapshotRef.current);
          if (userIdRef.current !== startedFor) return;
          commit(next);
          setError(null);
        } catch (e) {
          setError(
            e instanceof NetworkError ? null : e instanceof Error ? e.message : 'Sync failed',
          );
        } finally {
          setSyncing(false);
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    [userId, ready, commit],
  );

  useEffect(() => {
    if (ready && userId) void refresh({ force: true });
  }, [ready, userId, refresh]);

  useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  // Something this phone did just reached the server (a wash, a payment): pull its effect.
  useEffect(() => {
    if (version > 0) void refresh({ force: true });
  }, [version, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, REFRESH_EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  const recordVisit = useCallback(
    (visit: LocalVisit) => commit(applyLocalVisit(snapshotRef.current, visit)),
    [commit],
  );

  const entries = useMemo(() => Object.values(snapshot.entries), [snapshot]);

  const value = useMemo<DirectoryContextValue>(
    () => ({
      entries,
      ready,
      syncing,
      lastSyncAt: snapshot.lastSyncAt,
      error,
      refresh,
      recordVisit,
    }),
    [entries, ready, syncing, snapshot.lastSyncAt, error, refresh, recordVisit],
  );

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory(): DirectoryContextValue {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error('useDirectory must be used inside DirectoryProvider');
  return ctx;
}
