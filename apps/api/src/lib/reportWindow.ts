import { z } from 'zod';
import {
  endOfIstDay,
  formatIstDateOnly,
  parseIstDateOnly,
  startOfIstDay,
  startOfIstDaysAgo,
  startOfIstMonth,
  startOfIstYear,
} from './istDate';

/** Shared `?range=` query for every owner report (stats, export, staff, audit, expenses). */
export const reportQuerySchema = z
  .object({
    range: z.enum(['today', 'week', 'month', 'year', 'custom']).default('today'),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.range !== 'custom') return;
    if (!q.from || !parseIstDateOnly(q.from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be YYYY-MM-DD', path: ['from'] });
    }
    if (!q.to || !parseIstDateOnly(q.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'to must be YYYY-MM-DD', path: ['to'] });
    }
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface ReportWindow {
  from: Date;
  to: Date;
  label: string;
}

/** Resolve a report window as half-open `[from, to)` in absolute UTC instants. */
export function resolveReportWindow(query: ReportQuery): ReportWindow | { error: string } {
  const now = new Date();
  if (query.range === 'today') {
    return { from: startOfIstDay(now), to: endOfIstDay(now), label: 'Today' };
  }
  if (query.range === 'week') {
    return { from: startOfIstDaysAgo(6, now), to: endOfIstDay(now), label: 'Last 7 days' };
  }
  if (query.range === 'month') {
    return { from: startOfIstMonth(now), to: endOfIstDay(now), label: 'This month' };
  }
  if (query.range === 'year') {
    return { from: startOfIstYear(now), to: endOfIstDay(now), label: 'This year' };
  }

  const from = parseIstDateOnly(query.from ?? '');
  const toStart = parseIstDateOnly(query.to ?? '');
  if (!from || !toStart) return { error: 'invalid_custom_range' };
  const to = endOfIstDay(toStart);
  if (from.getTime() >= to.getTime()) return { error: 'from_after_to' };
  // Guardrail: don't let a year+ custom range accidentally dump the whole DB into a phone.
  const maxMs = 366 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) return { error: 'range_too_long' };

  return { from, to, label: `${formatIstDateOnly(from)} → ${formatIstDateOnly(toStart)}` };
}

/** The window echoed back to the client as inclusive IST dates. */
export function windowMeta(query: ReportQuery, window: ReportWindow) {
  return {
    range: query.range,
    label: window.label,
    from: formatIstDateOnly(window.from),
    to: formatIstDateOnly(new Date(window.to.getTime() - 1)),
  };
}
