import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { APP_VERSION } from '../config/app';

const QUEUE_KEY = 'mana.errors.v1';
const MAX_QUEUED = 20;

interface QueuedError {
  message: string;
  stack?: string;
  context?: string;
  appVersion: string;
}

async function readQueue(): Promise<QueuedError[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedError[]) : [];
  } catch {
    return [];
  }
}

/** Saves a crash on the phone; it's sent the next time someone is signed in and online. */
export async function queueError(error: unknown, context?: string): Promise<void> {
  const e = error instanceof Error ? error : new Error(String(error));
  const entry: QueuedError = {
    message: (e.message || e.name || 'Unknown error').slice(0, 2000),
    stack: e.stack?.slice(0, 8000),
    context: context?.slice(0, 2000),
    appVersion: APP_VERSION,
  };
  const queue = await readQueue();
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, entry].slice(-MAX_QUEUED)));
  } catch {
    // Nowhere left to record it.
  }
}

let flushing = false;

export async function flushErrors(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const res = await api.shop.errors.$post({ json: queue[0]! });
      // A rejected report (e.g. too long) would block the rest forever, so only a 5xx stops us.
      if (!res.ok && res.status >= 500) break;
      queue = queue.slice(1);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Offline or signed out: try again later.
  } finally {
    flushing = false;
  }
}

/** Records uncaught JS errors before handing them to React Native's default handler. */
export function installGlobalErrorHandler(): void {
  const g = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const utils = g.ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    void queueError(error, isFatal ? 'fatal' : 'non-fatal').finally(() => previous(error, isFatal));
  });
}
