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

function position(highAccuracy: boolean, maximumAge: number): Promise<Point> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15_000 : 8_000, maximumAge },
    );
  });
}

/** Where the phone is now, for pinning a community's gate. Throws a LocationError fit to show. */
export async function currentLocation(why = 'To pin the community’s gate where you are standing.'): Promise<Point> {
  if (!(await askPermission(why))) {
    throw new LocationError('Location is off for this app. Drag the pin, or type the location.', 'denied');
  }
  try {
    return await position(true, 30_000);
  } catch (first) {
    if ((first as { code?: number }).code === 1) {
      throw new LocationError('Location is off for this app. Drag the pin, or type the location.', 'denied');
    }
    try {
      return await position(false, 60_000);
    } catch {
      throw new LocationError('Couldn’t find your location. Turn on location (GPS) and try again.', 'unavailable');
    }
  }
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
