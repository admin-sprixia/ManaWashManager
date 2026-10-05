import { Linking, Platform, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { showToast } from '@mana/ui';

/** Android 13+ shows its own "Copied" popup, so a toast there would say it twice. */
export function copyText(text: string, toast: string) {
  Clipboard.setString(text);
  if (Platform.OS === 'android' && Platform.Version >= 33) return;
  showToast(toast);
}

async function open(url: string, failure: string) {
  try {
    await Linking.openURL(url);
  } catch {
    showToast(failure, 'error');
  }
}

export function callNumber(phone: string) {
  void open(`tel:+91${phone}`, 'Couldn’t start a call on this phone.');
}

/** wa.me opens WhatsApp when it's installed, and the browser otherwise — no package checks needed. */
export function messageOnWhatsApp(phone: string, text?: string) {
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  void open(`https://wa.me/91${phone}${query}`, 'Couldn’t open WhatsApp.');
}

/** WhatsApp's own "send to…" picker with the text filled in. */
export function shareOnWhatsApp(text: string) {
  void open(`https://wa.me/?text=${encodeURIComponent(text)}`, 'Couldn’t open WhatsApp.');
}

/** Google Maps directions to a pin, or a search for the address when there's no pin. */
export function openDirections(place: {
  location: { latitude: number; longitude: number } | null;
  address: string | null;
  name: string;
}) {
  const destination = place.location
    ? `${place.location.latitude},${place.location.longitude}`
    : encodeURIComponent(place.address ?? place.name);
  void open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, 'Couldn’t open maps.');
}

export function openLink(url: string) {
  void open(url, 'Couldn’t open the link.');
}

export async function shareText(message: string) {
  try {
    await Share.share({ message });
  } catch {
    showToast('Couldn’t open sharing on this phone.', 'error');
  }
}
