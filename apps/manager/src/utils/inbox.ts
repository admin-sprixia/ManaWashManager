/** "98765 43210". */
export function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

/** "10:42 am" today, "Yesterday", "Mon", or "28 Oct", like a chat list. */
export function inboxTime(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (days === 0) return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-IN', { weekday: 'short' });
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "10:42 am" for a bubble. */
export function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
