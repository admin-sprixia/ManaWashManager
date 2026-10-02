import { Linking } from 'react-native';
import { showToast } from '../components/Toast';
import { buildWhatsAppLink } from './format';

/** Opens a WhatsApp chat with the message typed in; resolves false if WhatsApp couldn't open. */
export function openWhatsApp(phone: string, message: string): Promise<boolean> {
  return Linking.openURL(buildWhatsAppLink(phone, message))
    .then(() => true)
    .catch(() => {
      showToast('Couldn’t open WhatsApp — is it installed?', 'error');
      return false;
    });
}
