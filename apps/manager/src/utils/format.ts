export { formatDateTime, formatRelativeDate, formatRupees } from '@mana/ui';

const IST_OFFSET_MS = 330 * 60_000;

/** Shop calendar day (IST) as YYYY-MM-DD, `daysAgo` days back — the key for cash days and attendance. */
export function istDate(daysAgo = 0): string {
  return new Date(Date.now() + IST_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** "Thu, 24 Sep" for a YYYY-MM-DD shop day. */
export function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Parses a rupee amount typed by a person into paise; null when empty, NaN when invalid. */
export function parseRupees(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/**
 * Normalizes a stored phone number (usually 10 raw digits, occasionally with a leading 0 or
 * an already-present country code) into the digits-only, country-code-prefixed form wa.me
 * needs. MANA is India-only, so the country code is always 91 — see the build plan's
 * Android-only / India-first scope note.
 */
export function toWhatsAppPhone(rawPhone: string): string {
  let digits = rawPhone.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${toWhatsAppPhone(phone)}?text=${encodeURIComponent(message)}`;
}
