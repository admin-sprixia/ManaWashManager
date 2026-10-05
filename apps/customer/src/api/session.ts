import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * What this phone remembers between launches. Secrets (the sign-in token and a service-request
 * ticket) live in the Android Keystore / iOS Keychain, readable only by this app; the rest is
 * display data in AsyncStorage.
 */

const TOKEN_SERVICE = 'com.sprixia.manacarwash.session';
const TICKET_SERVICE = 'com.sprixia.manacarwash.request';
const ACCOUNT_KEY = 'manacarwash.account';
const LAST_PHONE_KEY = 'manacarwash.last_phone';

export interface Account {
  phone: string;
  name: string | null;
  branches: { id: string; name: string; city: string | null }[];
}

/** A number the car wash hasn't registered yet: it can ask for service and follow that request. */
export interface RequestPass {
  phone: string;
  ticket: string;
}

/** `username` holds the phone number the secret belongs to. */
async function readSecret(service: string): Promise<{ username: string; password: string } | null> {
  try {
    const saved = await Keychain.getGenericPassword({ service });
    return saved ? { username: saved.username, password: saved.password } : null;
  } catch {
    return null;
  }
}

async function writeSecret(service: string, username: string, value: string): Promise<void> {
  await Keychain.setGenericPassword(username, value, {
    service,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function clearSecret(service: string): Promise<void> {
  await Keychain.resetGenericPassword({ service }).catch(() => false);
}

function parse<T>(raw: string | null): Partial<T> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Partial<T>) : null;
  } catch {
    return null;
  }
}

// Every request needs the token, so it's held in memory after the first read.
let tokenCache: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (tokenCache === undefined) tokenCache = (await readSecret(TOKEN_SERVICE))?.password ?? null;
  return tokenCache;
}

export async function saveSignIn(token: string, account: Account): Promise<void> {
  tokenCache = token;
  await writeSecret(TOKEN_SERVICE, account.phone, token);
  await Promise.all([saveAccount(account), clearSecret(TICKET_SERVICE), setLastPhone(account.phone)]);
}

export async function getAccount(): Promise<Account | null> {
  const a = parse<Account>(await AsyncStorage.getItem(ACCOUNT_KEY));
  if (!a?.phone) return null;
  // Accounts saved by an older build have branches without ids; the next refresh fills them in.
  const branches = Array.isArray(a.branches) ? a.branches.filter((b) => typeof b?.id === 'string') : [];
  return { phone: a.phone, name: a.name ?? null, branches };
}

export async function saveAccount(account: Account): Promise<void> {
  await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export async function getRequestPass(): Promise<RequestPass | null> {
  const saved = await readSecret(TICKET_SERVICE);
  return saved?.username && saved.password ? { phone: saved.username, ticket: saved.password } : null;
}

export async function saveRequestPass(pass: RequestPass): Promise<void> {
  await writeSecret(TICKET_SERVICE, pass.phone, pass.ticket);
  await setLastPhone(pass.phone);
}

/** Forget the sign-in and any request ticket. The last number stays, to prefill sign-in. */
export async function clearSession(): Promise<void> {
  tokenCache = null;
  await Promise.all([clearSecret(TOKEN_SERVICE), clearSecret(TICKET_SERVICE), AsyncStorage.removeItem(ACCOUNT_KEY)]);
}

export async function getLastPhone(): Promise<string> {
  return (await AsyncStorage.getItem(LAST_PHONE_KEY)) ?? '';
}

async function setLastPhone(phone: string): Promise<void> {
  await AsyncStorage.setItem(LAST_PHONE_KEY, phone);
}
