import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

Geolocation.setRNConfiguration({
  skipPermissionRequests: Platform.OS === 'android',
  authorizationLevel: 'whenInUse',
  locationProvider: 'auto',
});

export class LocationError extends Error {
  constructor(
    message: string,
    readonly reason: 'denied' | 'unavailable',
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

async function askPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request('android.permission.ACCESS_FINE_LOCATION', {
    title: 'Share your location',
    message: 'MANA Car Wash uses it once, to check that we wash in your area.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function position(highAccuracy: boolean): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15_000 : 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

/** Where the phone is, asked once. Throws a LocationError with a message fit to show. */
export async function currentLocation(): Promise<Coordinates> {
  if (!(await askPermission())) {
    throw new LocationError('Location is off for MANA Car Wash. Pick your area from the list instead.', 'denied');
  }
  try {
    return await position(true);
  } catch (first) {
    if ((first as { code?: number }).code === 1) {
      throw new LocationError('Location is off for MANA Car Wash. Pick your area from the list instead.', 'denied');
    }
    // GPS can't get a fix indoors; the network location is close enough for an area check.
    try {
      return await position(false);
    } catch {
      throw new LocationError('Couldn’t find your location. Turn on location, or pick your area.', 'unavailable');
    }
  }
}
