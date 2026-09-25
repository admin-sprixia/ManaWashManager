import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'mana.cache.';

/**
 * Last-known-good copies of server data, so the board and New Wash open instantly and keep
 * working with no signal. Always overwritten by the next successful fetch.
 */
export const CacheKeys = {
  catalog: 'catalog.v2',
  jobsToday: 'jobs.today.v2',
  directory: 'directory.v1',
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

/** Signing out clears cached shop data so the next person doesn't see a stale board. */
export async function clearCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
}
