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
import { getSessionToken } from '../api/session';
import { showToast } from '@mana/ui';
import { queueError } from '../utils/errorReporter';
import { newId } from '../utils/id';
import { opLocalFiles, sendOp } from './dispatch';
import { deleteLocalCopy } from './photoFiles';
import { opJobId, type OutboxItem, type OutboxOp } from './types';

const STORAGE_KEY = 'mana.outbox.v1';
/**
 * Where changes go while the saved queue can't be read: the main copy is never overwritten then,
 * and both are merged back as soon as it reads again (here or on the next start).
 */
const SIDE_KEY = `${STORAGE_KEY}.while-unreadable`;
const READ_TRIES = 3;

async function readList(key: string): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Outbox is not a list');
  return value as OutboxItem[];
}

/** Both lists, each item once (the first copy wins), oldest first. */
function mergeById(a: OutboxItem[], b: OutboxItem[]): OutboxItem[] {
  const seen = new Set<string>();
  const out: OutboxItem[] = [];
  for (const i of [...a, ...b]) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** Whether an item belongs to the branch now signed in (older saved items: by their maker). */
function inShop(i: OutboxItem, user: { id: string; shopId: string }): boolean {
  return i.shopId ? i.shopId === user.shopId : i.userId === user.id;
}
/** While changes are waiting, keep probing for signal at this interval. */
const RETRY_INTERVAL_MS = 15_000;
/** Server-side failures (5xx, rate limit) before a change is parked for the user to retry. */
const MAX_SERVER_ATTEMPTS = 8;
/** 15 s, 30 s, 1 min … capped at 15 min between tries after a server-side failure. */
function backoffMs(attempts: number): number {
  return Math.min(RETRY_INTERVAL_MS * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

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
  /** Every outbox item on this phone, oldest first (all users, all branches). */
  items: OutboxItem[];
  /** This branch's items, anyone's: what the board and wash pages overlay. */
  shopItems: OutboxItem[];
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
  const flushing = useRef<Promise<void> | null>(null);
  /** False once this provider is replaced (sign-out, switching branch): it must not touch storage. */
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  /** The saved queue couldn't be read: write to SIDE_KEY, never over it. */
  const unreadable = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  const storageWarned = useRef(false);
  // Changes submitted before the saved outbox is read would be overwritten by it.
  const loadGate = useRef<{ promise: Promise<void>; open: () => void } | null>(null);
  if (!loadGate.current) {
    let open = () => {};
    const promise = new Promise<void>((resolve) => (open = resolve));
    loadGate.current = { promise, open };
  }

  const commit = useCallback(async (next: OutboxItem[]) => {
    if (!alive.current) return;
    itemsRef.current = next;
    setItems(next);
    try {
      if (unreadable.current) {
        // Try the saved copy again; once it reads, merge it in and go back to normal.
        try {
          const saved = await readList(STORAGE_KEY);
          unreadable.current = false;
          const merged = mergeById(itemsRef.current, saved);
          itemsRef.current = merged;
          setItems(merged);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          await AsyncStorage.removeItem(SIDE_KEY);
        } catch {
          await AsyncStorage.setItem(SIDE_KEY, JSON.stringify(itemsRef.current));
        }
      } else {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(itemsRef.current));
      }
      storageWarned.current = false;
    } catch (e) {
      // Still held in memory and will sync while the app stays open; say so once.
      if (!storageWarned.current) {
        storageWarned.current = true;
        showToast('Couldn’t save to this phone’s storage. Free up space so waiting changes aren’t lost.', 'error');
        void queueError(e, 'outbox save');
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      let parsed: OutboxItem[] = [];
      let readOk = false;
      for (let attempt = 0; attempt < READ_TRIES && !readOk; attempt++) {
        let raw: string | null = null;
        try {
          raw = await AsyncStorage.getItem(STORAGE_KEY);
        } catch (e) {
          if (attempt === READ_TRIES - 1) void queueError(e, 'outbox load');
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        readOk = true;
        try {
          const value: unknown = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(value)) throw new Error('Outbox is not a list');
          parsed = value as OutboxItem[];
        } catch (e) {
          // Damaged beyond reading: keep the copy for support, start a fresh queue.
          void queueError(e, 'outbox load');
          if (raw) void AsyncStorage.setItem(`${STORAGE_KEY}.unreadable`, raw).catch(() => undefined);
        }
      }
      if (!readOk) {
        unreadable.current = true;
        showToast('Couldn’t read the changes waiting on this phone. New changes are kept safely apart until it reads again.', 'error');
      }
      // Changes kept apart while the queue couldn't be read last time.
      try {
        const side = await readList(SIDE_KEY);
        if (side.length) {
          parsed = mergeById(parsed, side);
          if (readOk) {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            await AsyncStorage.removeItem(SIDE_KEY);
          }
        }
      } catch {
        // Nothing kept apart (or unreadable too): carry on with what we have.
      }
      if (!alive.current) return;
      itemsRef.current = parsed;
      setItems(parsed);
      setLoaded(true);
      loadGate.current?.open();
    })();
  }, []);

  useEffect(() => subscribeOnline(setOnlineState), []);

  const flush = useCallback((): Promise<void> => {
    const me = userRef.current;
    if (!me || !alive.current) return Promise.resolve();
    // One sync at a time; a second caller waits for the one already running.
    if (flushing.current) return flushing.current;
    const run = flushRound(me);
    flushing.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  const flushRound = async (me: NonNullable<typeof user>) => {
    setSyncing(true);
    let delivered = false;
    try {
      // Everything this round sends goes as the session it started with: switching branch
      // mid-sync signs in as another account, and its changes mustn't reach that branch.
      const token = await getSessionToken();
      if (!token) return;
      for (;;) {
        // Replaced (switched branch, signed out): stop before sending anything else.
        if (!alive.current || userRef.current?.id !== me.id) break;
        const next = itemsRef.current.find((i) => i.userId === me.id && i.state === 'pending');
        if (!next) break;
        // Backing off after a server-side failure; everything behind it waits its turn.
        if (next.nextAttemptAt && next.nextAttemptAt > Date.now()) break;

        const result = await sendOp(next.op, token);
        if (result.ok || (!result.ok && result.kind === 'superseded')) {
          delivered = true;
          await commit(itemsRef.current.filter((i) => i.id !== next.id));
          continue;
        }
        if (result.kind === 'network' || result.kind === 'auth') break;
        let failMessage: string;
        if (result.kind === 'retry') {
          const attempts = next.attempts + 1;
          if (attempts < MAX_SERVER_ATTEMPTS) {
            await commit(
              itemsRef.current.map((i) =>
                i.id === next.id
                  ? { ...i, attempts, nextAttemptAt: Date.now() + backoffMs(attempts), error: result.message }
                  : i,
              ),
            );
            break;
          }
          failMessage = `${result.message} (tried ${attempts} times)`;
        } else {
          failMessage = result.message;
        }
        // Rejected: park it, and park anything queued after it for the same job — those
        // changes only make sense if this one landed.
        const jobId = opJobId(next.op);
        const nextIndex = itemsRef.current.findIndex((i) => i.id === next.id);
        await commit(
          itemsRef.current.map((i, idx) => {
            if (i.id === next.id) return { ...i, state: 'failed' as const, error: failMessage };
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
      flushing.current = null;
      if (alive.current) {
        setSyncing(false);
        if (delivered) {
          setLastSyncedAt(Date.now());
          setVersion((v) => v + 1);
        }
      }
    }
  };

  const submit = useCallback(
    async (op: OutboxOp, options?: SubmitOptions): Promise<SubmitResult> => {
      await loadGate.current?.promise;
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
        if (result.kind === 'auth') return { status: 'rejected', message: 'Your session ended. Sign in again.' };
        if (result.kind === 'superseded') return { status: 'sent', data: null };
        return { status: 'rejected', message: result.message };
      }

      // A wash still waiting on someone else's change (their unsynced "start"): this change would
      // reach the server before theirs and fail, so it waits for them.
      const jobId = opJobId(op);
      const blocker = jobId
        ? itemsRef.current.find((i) => i.userId !== me.id && opJobId(i.op) === jobId)
        : undefined;
      if (blocker) {
        return {
          status: 'rejected',
          message: `${blocker.userName.split(/\s+/)[0] ?? 'A teammate'} has changes to this wash that haven’t synced yet. They sync when ${blocker.userName.split(/\s+/)[0] ?? 'they'} sign in on this phone.`,
        };
      }

      const item: OutboxItem = {
        id: newId(),
        userId: me.id,
        userName: me.name,
        shopId: me.shopId,
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
        if (result.kind === 'rejected') {
          return { status: 'rejected', message: result.message };
        }
      }

      await commit([...itemsRef.current, item]);
      if (isOnline()) void flush();
      return { status: 'queued' };
    },
    [commit, flush],
  );

  // A manual sync with nothing waiting still counts: screens refetch and the time updates.
  const syncNow = useCallback(async () => {
    await flush();
    const me = userRef.current;
    if (!me || !isOnline()) return;
    if (itemsRef.current.some((i) => i.userId === me.id && i.state === 'pending')) return;
    setLastSyncedAt(Date.now());
    setVersion((v) => v + 1);
  }, [flush]);

  const retry = useCallback(
    async (itemId: string) => {
      await commit(
        itemsRef.current.map((i) =>
          i.id === itemId
            ? { ...i, state: 'pending' as const, error: undefined, attempts: 0, nextAttemptAt: undefined }
            : i,
        ),
      );
      await flush();
    },
    [commit, flush],
  );

  const discard = useCallback(
    async (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (item) for (const uri of opLocalFiles(item.op)) void deleteLocalCopy(uri);
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
  const shopItems = useMemo(() => (user ? items.filter((i) => inShop(i, user)) : []), [items, user]);
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
      shopItems,
      myItems,
      pendingCount,
      failedCount,
      version,
      submit,
      syncNow,
      retry,
      discard,
    }),
    [
      online,
      syncing,
      lastSyncedAt,
      items,
      shopItems,
      myItems,
      pendingCount,
      failedCount,
      version,
      submit,
      syncNow,
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
