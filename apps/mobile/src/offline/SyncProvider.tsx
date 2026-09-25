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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../api/auth';
import { isOnline, subscribeOnline } from '../api/network';
import { newId } from '../utils/id';
import { sendOp } from './dispatch';
import { opJobId, type OutboxItem, type OutboxOp } from './types';

const STORAGE_KEY = 'mana.outbox.v1';
/** While changes are waiting, keep probing for signal at this interval. */
const RETRY_INTERVAL_MS = 15_000;

export type SubmitResult =
  | { status: 'sent'; data: unknown }
  | { status: 'queued' }
  | { status: 'rejected'; message: string };

export interface SubmitOptions {
  /** Send now or fail — never park it in the outbox (e.g. coupon redemption must be checked live). */
  requireOnline?: boolean;
}

interface SyncContextValue {
  online: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  /** Every outbox item on this phone, oldest first (all users). */
  items: OutboxItem[];
  /** Items the signed-in user can sync right now. */
  myItems: OutboxItem[];
  pendingCount: number;
  failedCount: number;
  /** Bumps whenever something reached the server — screens re-fetch when it changes. */
  version: number;
  /**
   * Send a change now if possible, otherwise queue it. Changes queue behind anything already
   * waiting, so a job's "start" always reaches the server before its "paid".
   */
  submit: (op: OutboxOp, options?: SubmitOptions) => Promise<SubmitResult>;
  syncNow: () => Promise<void>;
  retry: (itemId: string) => Promise<void>;
  discard: (itemId: string) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnlineState] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const itemsRef = useRef<OutboxItem[]>([]);
  const flushing = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  const commit = useCallback(async (next: OutboxItem[]) => {
    itemsRef.current = next;
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
      itemsRef.current = parsed;
      setItems(parsed);
      setLoaded(true);
    });
  }, []);

  useEffect(() => subscribeOnline(setOnlineState), []);

  const flush = useCallback(async () => {
    const me = userRef.current;
    if (!me || flushing.current) return;
    flushing.current = true;
    setSyncing(true);
    let delivered = false;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.userId === me.id && i.state === 'pending');
        if (!next) break;

        const result = await sendOp(next.op);
        if (result.ok || (!result.ok && result.kind === 'superseded')) {
          delivered = true;
          await commit(itemsRef.current.filter((i) => i.id !== next.id));
          continue;
        }
        if (result.kind === 'network') break;
        if (result.kind === 'retry') {
          await commit(
            itemsRef.current.map((i) =>
              i.id === next.id ? { ...i, attempts: i.attempts + 1, error: result.message } : i,
            ),
          );
          break;
        }
        // Rejected: park it, and park anything queued after it for the same job — those
        // changes only make sense if this one landed.
        const jobId = opJobId(next.op);
        const nextIndex = itemsRef.current.findIndex((i) => i.id === next.id);
        await commit(
          itemsRef.current.map((i, idx) => {
            if (i.id === next.id) return { ...i, state: 'failed' as const, error: result.message };
            if (
              next.op.kind === 'job.start' &&
              jobId &&
              idx > nextIndex &&
              i.state === 'pending' &&
              opJobId(i.op) === jobId
            ) {
              return {
                ...i,
                state: 'failed' as const,
                error: 'The new wash this depends on didn’t sync.',
              };
            }
            return i;
          }),
        );
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
      if (delivered) {
        setLastSyncedAt(Date.now());
        setVersion((v) => v + 1);
      }
    }
  }, [commit]);

  const submit = useCallback(
    async (op: OutboxOp, options?: SubmitOptions): Promise<SubmitResult> => {
      const me = userRef.current;
      if (!me) return { status: 'rejected', message: 'You’re signed out.' };

      if (options?.requireOnline) {
        const offline = 'No connection — this needs internet. Try again when you’re back online.';
        if (!isOnline()) return { status: 'rejected', message: offline };
        const result = await sendOp(op);
        if (result.ok) {
          setLastSyncedAt(Date.now());
          setVersion((v) => v + 1);
          return { status: 'sent', data: result.data };
        }
        if (result.kind === 'network') return { status: 'rejected', message: offline };
        if (result.kind === 'superseded') return { status: 'sent', data: null };
        return { status: 'rejected', message: result.message };
      }

      const item: OutboxItem = {
        id: newId(),
        userId: me.id,
        userName: me.name,
        createdAt: new Date().toISOString(),
        attempts: 0,
        state: 'pending',
        op,
      };
      const waiting = itemsRef.current.some((i) => i.userId === me.id && i.state === 'pending');

      if (!waiting && isOnline()) {
        const result = await sendOp(op);
        if (result.ok) {
          setLastSyncedAt(Date.now());
          setVersion((v) => v + 1);
          return { status: 'sent', data: result.data };
        }
        if (result.kind === 'superseded') {
          setVersion((v) => v + 1);
          return { status: 'sent', data: null };
        }
        if (result.kind === 'rejected') return { status: 'rejected', message: result.message };
      }

      await commit([...itemsRef.current, item]);
      if (isOnline()) void flush();
      return { status: 'queued' };
    },
    [commit, flush],
  );

  const retry = useCallback(
    async (itemId: string) => {
      await commit(
        itemsRef.current.map((i) =>
          i.id === itemId ? { ...i, state: 'pending' as const, error: undefined, attempts: 0 } : i,
        ),
      );
      await flush();
    },
    [commit, flush],
  );

  const discard = useCallback(
    async (itemId: string) => {
      await commit(itemsRef.current.filter((i) => i.id !== itemId));
      setVersion((v) => v + 1);
    },
    [commit],
  );

  // Triggers: sign-in / load, app back to foreground, signal returning, and a steady probe
  // while anything is waiting.
  useEffect(() => {
    if (loaded && user) void flush();
  }, [loaded, user, flush]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    return () => sub.remove();
  }, [flush]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  const myItems = useMemo(
    () => (user ? items.filter((i) => i.userId === user.id) : []),
    [items, user],
  );
  const pendingCount = myItems.filter((i) => i.state === 'pending').length;
  const failedCount = myItems.filter((i) => i.state === 'failed').length;

  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => void flush(), RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pendingCount, flush]);

  const value = useMemo<SyncContextValue>(
    () => ({
      online,
      syncing,
      lastSyncedAt,
      items,
      myItems,
      pendingCount,
      failedCount,
      version,
      submit,
      syncNow: flush,
      retry,
      discard,
    }),
    [
      online,
      syncing,
      lastSyncedAt,
      items,
      myItems,
      pendingCount,
      failedCount,
      version,
      submit,
      flush,
      retry,
      discard,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
