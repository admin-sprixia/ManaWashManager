import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'mana.cache.';

/**
 * Last-known-good copies of server data, so the board and New Wash open instantly and keep
 * working with no signal. Always overwritten by the next successful fetch.
 */
export const CacheKeys = {
  catalog: 'catalog.v2',
  jobsToday: 'jobs.today.v2',
  /** Chunked: `directory.v2.meta` + `directory.v2.part.N`. */
  directory: 'directory.v2',
  /** Older single-value copy, read once and then removed. */
  directoryV1: 'directory.v1',
  shop: 'shop.v1',
  stock: 'stock.v1',
} as const;

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A full disk shouldn't break the screen that tried to cache.
  }
}

/** Items per stored chunk. Android can't read one stored value much over 2 MB. */
const CHUNK_ITEMS = 1000;

/**
 * A big list stored in chunks plus a small header. All chunks and the header are written in one
 * `multiSet` (a single transaction on Android), so a reader never sees half of a new copy.
 */
export async function writeChunkedCache<M extends object, T>(key: string, meta: M, list: T[]): Promise<void> {
  try {
    const previous = await readCache<{ chunks?: number }>(`${key}.meta`);
    const pairs: [string, string][] = [];
    const chunks = Math.ceil(list.length / CHUNK_ITEMS);
    for (let i = 0; i < chunks; i++) {
      pairs.push([`${PREFIX}${key}.part.${i}`, JSON.stringify(list.slice(i * CHUNK_ITEMS, (i + 1) * CHUNK_ITEMS))]);
    }
    pairs.push([`${PREFIX}${key}.meta`, JSON.stringify({ ...meta, chunks })]);
    await AsyncStorage.multiSet(pairs);
    const stale = [];
    for (let i = chunks; i < (previous?.chunks ?? 0); i++) stale.push(`${PREFIX}${key}.part.${i}`);
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // As with writeCache: a full disk keeps the copy already in memory working.
  }
}

export async function readChunkedCache<M extends object, T>(key: string): Promise<{ meta: M; list: T[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${key}.meta`);
    if (!raw) return null;
    const meta = JSON.parse(raw) as M & { chunks: number };
    const keys = Array.from({ length: meta.chunks }, (_, i) => `${PREFIX}${key}.part.${i}`);
    const parts = keys.length ? await AsyncStorage.multiGet(keys) : [];
    const list: T[] = [];
    for (const [, value] of parts) {
      if (!value) return null; // A chunk is missing: treat the whole copy as gone.
      list.push(...(JSON.parse(value) as T[]));
    }
    return { meta, list };
  } catch {
    return null;
  }
}

export async function removeCache(key: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + key).catch(() => undefined);
}

/** Signing out clears cached shop data so the next person doesn't see a stale board. */
export async function clearCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
}
