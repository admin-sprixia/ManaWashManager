const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Cloudflare Workers run their JS clock in UTC — MANA runs in IST (UTC+5:30, no DST).
 * "Today" and period boundaries must be computed against IST wall-clock time, or the
 * boundary drifts by 5.5 hours.
 */
export function startOfIstDay(reference = new Date()): Date {
  const istNow = new Date(reference.getTime() + IST_OFFSET_MS);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - IST_OFFSET_MS);
}

/** Exclusive end of an IST day = start of the next IST day. */
export function endOfIstDay(reference = new Date()): Date {
  return new Date(startOfIstDay(reference).getTime() + 24 * 60 * 60 * 1000);
}

/** Start of the IST day N days before `reference` — used for rolling week ranges. */
export function startOfIstDaysAgo(days: number, reference = new Date()): Date {
  const start = startOfIstDay(reference);
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

/** First moment of the current IST calendar month. */
export function startOfIstMonth(reference = new Date()): Date {
  const istNow = new Date(reference.getTime() + IST_OFFSET_MS);
  istNow.setUTCDate(1);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - IST_OFFSET_MS);
}

/** First moment of the current IST calendar year. */
export function startOfIstYear(reference = new Date()): Date {
  const istNow = new Date(reference.getTime() + IST_OFFSET_MS);
  istNow.setUTCMonth(0, 1);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - IST_OFFSET_MS);
}

/** Parse `YYYY-MM-DD` as the start of that IST calendar day. */
export function parseIstDateOnly(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Build noon UTC on that civil date, then snap to IST day start — avoids DST-less off-by-one.
  const approx = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return startOfIstDay(approx);
}

/** Format a Date as IST `YYYY-MM-DD`. */
export function formatIstDateOnly(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
