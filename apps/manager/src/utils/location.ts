import { NativeModules, PermissionsAndroid, Platform, type Permission } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export interface Point {
  latitude: number;
  longitude: number;
}

Geolocation.setRNConfiguration({
  skipPermissionRequests: Platform.OS === 'android',
  authorizationLevel: 'whenInUse',
  locationProvider: 'auto',
});

/** Whether this build has a Google Maps key (set in android/local.properties as MAPS_API_KEY). */
const appConfig = NativeModules.AppConfig as unknown as { mapsEnabled?: boolean } | undefined;
export const mapsEnabled = appConfig?.mapsEnabled === true;

export class LocationError extends Error {
  constructor(
    message: string,
    readonly reason: 'denied' | 'unavailable',
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

const FINE: Permission = 'android.permission.ACCESS_FINE_LOCATION';

async function askPermission(why: string): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (await PermissionsAndroid.check(FINE)) return true;
  const granted = await PermissionsAndroid.request(FINE, {
    title: 'Use your location',
    message: why,
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/** A position and how sure the phone is of it, in metres (null when it doesn't say). */
export interface Fix extends Point {
  accuracy: number | null;
}

function position(highAccuracy: boolean, maximumAge: number, timeout = highAccuracy ? 12_000 : 4_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      (e) => reject(e),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge },
    );
  });
}

const DENIED = 'Location is off for this app. Drag the pin, or type the location.';
const NO_FIX = 'Couldn’t find your location. Turn on location (GPS) and try again.';
/** Good enough to stop sharpening: a gate pin within this many metres. */
const SHARP_M = 15;
/** A quick fix this close is used as it is, without waiting for satellites. */
const QUICK_OK_M = 150;
/** Stop sharpening after this long, keeping the best fix so far. */
const SHARPEN_FOR_MS = 25_000;

/**
 * Where the phone is now, fast: a quick fix from Wi-Fi and towers (or a recent one) first, and the
 * satellites only when that isn't close enough. Throws a LocationError fit to show.
 */
export async function currentLocation(why = 'To pin the community’s gate where you are standing.'): Promise<Point> {
  if (!(await askPermission(why))) throw new LocationError(DENIED, 'denied');
  let quick: Fix | null = null;
  try {
    quick = await position(false, 2 * 60_000);
    if (quick.accuracy != null && quick.accuracy <= QUICK_OK_M) return quick;
  } catch (e) {
    if ((e as { code?: number }).code === 1) throw new LocationError(DENIED, 'denied');
  }
  try {
    return await position(true, 30_000);
  } catch (e) {
    if ((e as { code?: number }).code === 1) throw new LocationError(DENIED, 'denied');
    if (quick) return quick;
    throw new LocationError(NO_FIX, 'unavailable');
  }
}

/**
 * Pinning a gate: shows a quick fix at once, then keeps sharpening with the satellites and calls
 * `onFix` each time it gets closer, until it's within SHARP_M metres or SHARPEN_FOR_MS passes.
 * `onEnd` gets an error message when no fix came at all. Returns a function that stops it (call
 * it when the person moves the pin themselves, or leaves the screen).
 */
export async function trackLocation(
  why: string,
  onFix: (fix: Fix) => void,
  onEnd: (error: string | null) => void,
): Promise<() => void> {
  if (!(await askPermission(why))) {
    onEnd(DENIED);
    return () => undefined;
  }
  let best: Fix | null = null;
  let stopped = false;
  let watchId: number | null = null;
  const take = (fix: Fix) => {
    if (stopped) return;
    const better = !best || best.accuracy == null || (fix.accuracy != null && fix.accuracy < best.accuracy);
    if (!better) return;
    best = fix;
    onFix(fix);
    if (fix.accuracy != null && fix.accuracy <= SHARP_M) stop(null);
  };
  const stop = (error: string | null) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (watchId != null) Geolocation.clearWatch(watchId);
    onEnd(error);
  };
  const timer = setTimeout(() => stop(best ? null : NO_FIX), SHARPEN_FOR_MS);

  // The quick fix (Wi-Fi, towers, or one from the last few minutes) and the satellites start together.
  position(false, 5 * 60_000).then(take, (e: { code?: number }) => {
    if (e.code === 1) stop(DENIED);
  });
  watchId = Geolocation.watchPosition(
    (p) => take({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
    (e) => {
      if (e.code === 1) stop(DENIED);
    },
    { enableHighAccuracy: true, distanceFilter: 0, interval: 1000, fastestInterval: 500 },
  );
  return () => stop(null);
}

/**
 * Where the washer is when they record a wash, to show the owner they were at the community.
 * Never blocks the wash: no permission or no fix gives null.
 */
export async function washLocation(): Promise<Point | null> {
  try {
    if (!(await askPermission('So the owner can see each wash was recorded at the community.'))) return null;
    return await position(false, 2 * 60_000);
  } catch {
    return null;
  }
}
