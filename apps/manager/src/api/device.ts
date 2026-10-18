import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * This install's own key, sent as `x-device-key` so a number can trust this phone after one
 * WhatsApp code. Made once and kept through sign-outs; only the server's hash of it is stored
 * there. Reinstalling the app makes a new one, which counts as a new phone.
 */
const DEVICE_SERVICE = 'com.sprixia.srimanawashpartner.device';
const DEVICE_KEY_FALLBACK = 'mana.device_key';

let cached: string | undefined;
let loading: Promise<string> | undefined;

function makeKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

async function load(): Promise<string> {
  try {
    const saved = await Keychain.getGenericPassword({ service: DEVICE_SERVICE });
    if (saved) return saved.password;
  } catch {
    // Keystore unavailable: fall back to the plain copy below.
  }
  const plain = await AsyncStorage.getItem(DEVICE_KEY_FALLBACK);
  if (plain) return plain;
  const key = makeKey();
  try {
    await Keychain.setGenericPassword('device', key, { service: DEVICE_SERVICE });
  } catch {
    await AsyncStorage.setItem(DEVICE_KEY_FALLBACK, key);
  }
  return key;
}

/** "Motorola XT2575" — how this phone is listed in More → Your phones. */
export function deviceLabel(): string | null {
  const c = Platform.constants as { Brand?: string; Manufacturer?: string; Model?: string };
  const brand = (c.Brand ?? c.Manufacturer ?? '').trim();
  const model = (c.Model ?? '').trim();
  const label = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
  const clean = label.replace(/[^\w .+()-]/g, '').trim().slice(0, 60);
  if (!clean) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export async function getDeviceKey(): Promise<string> {
  if (cached) return cached;
  loading ??= load().then((key) => (cached = key));
  return loading;
}
