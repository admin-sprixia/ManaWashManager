import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const SESSION_TOKEN_KEY = 'mana.session_token';
const SESSION_USER_KEY = 'mana.session_user';
const LAST_PHONE_KEY = 'mana.last_phone';
const LAST_METHOD_KEY = 'mana.last_login_method';
const CACHE_SHOP_KEY = 'mana.cache_shop';
const JOIN_REQUEST_KEY = 'mana.join_request';
const LAST_SHOP_KEY = 'mana.last_shop';

export interface SessionUser {
  id: string;
  name: string;
  phone: string;
  role: 'owner' | 'staff';
  hasPin: boolean;
  shopId: string;
}

/** Sign-in is PIN only; kept as a type so stored hints from older builds still parse. */
export type LoginMethod = 'pin';

/** A saved value that's been corrupted reads as "nothing saved" rather than crashing start-up. */
function parseStored<T>(raw: string | null): Partial<T> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Partial<T>) : null;
  } catch {
    return null;
  }
}

/**
 * The session token lives in the Android Keystore (encrypted, readable only by this app), not
 * in plain AsyncStorage. Every request needs it, so it's also held in memory after first read.
 */
const KEYCHAIN_SERVICE = 'com.sprixia.manawashmanager.session';
let tokenCache: string | null | undefined;

export async function getSessionToken(): Promise<string | null> {
  if (tokenCache !== undefined) return tokenCache;
  try {
    const saved = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (saved) return (tokenCache = saved.password);
  } catch {
    // Keystore unavailable on this phone: fall through to the plain copy below.
  }
  // Saved by an older build (or the Keystore fallback): move it into the Keystore.
  const plain = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
  if (plain) await setSessionToken(plain);
  else tokenCache = null;
  return plain;
}

export async function setSessionToken(token: string): Promise<void> {
  tokenCache = token;
  try {
    await Keychain.setGenericPassword('session', token, { service: KEYCHAIN_SERVICE });
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // A rare phone without a working Keystore still has to stay signed in.
    await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
  }
}

/** Wipe token + cached user — used on logout and when the API rejects the session. */
export async function clearSession(): Promise<void> {
  tokenCache = null;
  await Promise.all([
    Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }).catch(() => false),
    AsyncStorage.multiRemove([SESSION_TOKEN_KEY, SESSION_USER_KEY]),
  ]);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const parsed = parseStored<SessionUser>(await AsyncStorage.getItem(SESSION_USER_KEY));
  // Saved by a build from before shops existed: sign in again.
  if (!parsed?.id || !parsed.name || !parsed.shopId) return null;
  return {
    id: parsed.id,
    name: parsed.name,
    phone: parsed.phone ?? '',
    role: parsed.role === 'owner' ? 'owner' : 'staff',
    hasPin: Boolean(parsed.hasPin),
    shopId: parsed.shopId,
  };
}

/** Which shop the phone's saved data (jobs, customers, catalog) belongs to. */
export async function getCacheShop(): Promise<string | null> {
  return AsyncStorage.getItem(CACHE_SHOP_KEY);
}

export async function setCacheShop(shopId: string): Promise<void> {
  await AsyncStorage.setItem(CACHE_SHOP_KEY, shopId);
}

export async function setSessionUser(user: SessionUser): Promise<void> {
  await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

/** Shared shop phones: remember who signed in last and how, so the next sign-in is one step. */
export async function getLoginHints(): Promise<{ phone: string; method: LoginMethod }> {
  const pairs = await AsyncStorage.multiGet([LAST_PHONE_KEY, LAST_METHOD_KEY]);
  const phone = pairs[0]?.[1] ?? '';
  return { phone, method: 'pin' };
}

export async function setLoginHints(phone: string, method: LoginMethod): Promise<void> {
  await AsyncStorage.multiSet([
    [LAST_PHONE_KEY, phone],
    [LAST_METHOD_KEY, method],
  ]);
}

/**
 * Owners with several branches: the shop this number had open last, so signing in again lands
 * there. Survives sign-out on purpose; only used for the same number.
 */
export async function getLastShop(phone: string): Promise<string | undefined> {
  const parsed = parseStored<{ phone: string; shopId: string }>(await AsyncStorage.getItem(LAST_SHOP_KEY));
  return parsed?.phone === phone && parsed.shopId ? parsed.shopId : undefined;
}

export async function setLastShop(phone: string, shopId: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SHOP_KEY, JSON.stringify({ phone, shopId }));
}

/** A request to join a shop that's waiting on the owner — reopens the waiting screen on launch. */
export interface SavedJoinRequest {
  phone: string;
  requestToken: string;
}

export async function getJoinRequest(): Promise<SavedJoinRequest | null> {
  const parsed = parseStored<SavedJoinRequest>(await AsyncStorage.getItem(JOIN_REQUEST_KEY));
  return parsed?.phone && parsed.requestToken
    ? { phone: parsed.phone, requestToken: parsed.requestToken }
    : null;
}

export async function setJoinRequest(request: SavedJoinRequest): Promise<void> {
  await AsyncStorage.setItem(JOIN_REQUEST_KEY, JSON.stringify(request));
}

export async function clearJoinRequest(): Promise<void> {
  await AsyncStorage.removeItem(JOIN_REQUEST_KEY);
}
