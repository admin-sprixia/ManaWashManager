import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_TOKEN_KEY = 'mana.session_token';
const SESSION_USER_KEY = 'mana.session_user';
const LAST_PHONE_KEY = 'mana.last_phone';
const LAST_METHOD_KEY = 'mana.last_login_method';

export interface SessionUser {
  id: string;
  name: string;
  phone: string;
  role: 'owner' | 'staff';
  hasPin: boolean;
}

export type LoginMethod = 'otp' | 'pin';

export async function getSessionToken(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
}

/** Wipe token + cached user — used on logout and when the API rejects the session. */
export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([SESSION_TOKEN_KEY, SESSION_USER_KEY]);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const raw = await AsyncStorage.getItem(SESSION_USER_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<SessionUser>;
  if (!parsed.id || !parsed.name) return null;
  return {
    id: parsed.id,
    name: parsed.name,
    phone: parsed.phone ?? '',
    role: parsed.role === 'owner' ? 'owner' : 'staff',
    hasPin: Boolean(parsed.hasPin),
  };
}

export async function setSessionUser(user: SessionUser): Promise<void> {
  await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

/** Shared shop phones: remember who signed in last and how, so the next sign-in is one step. */
export async function getLoginHints(): Promise<{ phone: string; method: LoginMethod }> {
  const pairs = await AsyncStorage.multiGet([LAST_PHONE_KEY, LAST_METHOD_KEY]);
  const phone = pairs[0]?.[1] ?? '';
  const method = pairs[1]?.[1];
  return { phone, method: method === 'pin' ? 'pin' : 'otp' };
}

export async function setLoginHints(phone: string, method: LoginMethod): Promise<void> {
  await AsyncStorage.multiSet([
    [LAST_PHONE_KEY, phone],
    [LAST_METHOD_KEY, method],
  ]);
}
