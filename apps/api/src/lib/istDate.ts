const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Cloudflare Workers run their JS clock in UTC — MANA runs in IST (UTC+5:30, no DST).
 * "Today" and "this week" must be computed against IST wall-clock time, or the boundary
 * drifts by 5.5 hours: a wash done at 1am IST would silently fall under "yesterday".
 */
export function startOfIstDay(reference = new Date()): Date {
  const istNow = new Date(reference.getTime() + IST_OFFSET_MS);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - IST_OFFSET_MS);
}

/** Start of the IST day N days before `reference` — used for the rolling 7-day report range. */
export function startOfIstDaysAgo(days: number, reference = new Date()): Date {
  const start = startOfIstDay(reference);
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}
