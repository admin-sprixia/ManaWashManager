import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_TOKEN_KEY = 'mana.session_token';
const SESSION_USER_KEY = 'mana.session_user';

export interface SessionUser {
  id: string;
  name: string;
  role: 'owner' | 'staff';
}

export async function getSessionToken(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
}

export async function clearSessionUser(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_USER_KEY);
}

/** Wipe token + cached user — used on logout and when the API returns 401. */
export async function clearSession(): Promise<void> {
  await Promise.all([clearSessionToken(), clearSessionUser()]);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const raw = await AsyncStorage.getItem(SESSION_USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export async function setSessionUser(user: SessionUser): Promise<void> {
  await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}
