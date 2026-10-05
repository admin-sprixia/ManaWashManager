import { Linking, Share } from 'react-native';
import { SUPPORT_EMAIL } from '../config/app';

/** Some mail apps drop very long mailto bodies; the share sheet fallback has no such limit. */
const MAX_MAILTO_BODY = 6000;

/**
 * Opens the phone's mail app with a pre-filled message to support. If there is no mail app,
 * falls back to the share sheet (WhatsApp, Gmail…) with the same text.
 */
export async function emailSupport(subject: string, body: string): Promise<void> {
  const trimmed = body.length > MAX_MAILTO_BODY ? `${body.slice(0, MAX_MAILTO_BODY)}\n…(trimmed)` : body;
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(trimmed)}`;
  try {
    await Linking.openURL(url);
  } catch {
    await Share.share({ title: subject, message: `To: ${SUPPORT_EMAIL}\n\n${body}` }).catch(() => undefined);
  }
}
