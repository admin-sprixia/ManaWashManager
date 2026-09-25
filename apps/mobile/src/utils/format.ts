/** Money is always paise (int) end to end — see the build plan's naming conventions. */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString('en-IN')}`;
}

/** "Today" / "Yesterday" / "3 days ago" for recent dates, falling back to a plain date
 * further out — used anywhere a last-visit or job date needs to read at a glance. */
export function formatRelativeDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Date + time for a job history row, e.g. "22 Sep · 4:08 pm". */
export function formatDateTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
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
