import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createDbClient, expenseRepo, jobRepo } from '@mana/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import type { Env } from '../types';

type AuditKind = 'job_void' | 'payment_change' | 'expense_void';

interface AuditItem {
  id: string;
  kind: AuditKind;
  at: string;
  by: { id: string; name: string };
  reason: string | null;
  amount: number;
  title: string;
  subtitle: string;
  fromValue: string | null;
  toValue: string | null;
  jobId: string | null;
}

// Owner-only team reports. Chained in one expression, with every input declared via
// `zValidator` — see the comment in routes/auth.ts for why both matter for Hono RPC's typing.
export const reportRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  // Per-person washes started, money collected (by method), voids, and payment corrections.
  .get('/staff', zValidator('query', reportQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const rows = await jobRepo.getStaffStats(db, window.from, window.to);
    return c.json({ ...windowMeta(query, window), rows });
  })
  // One chronological feed of every money correction: voided jobs, payment-method changes,
  // and voided expenses — each with who did it and the reason they gave.
  .get('/audit', zValidator('query', reportQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const [events, voidedExpenses] = await Promise.all([
      jobRepo.listCorrections(db, window.from, window.to),
      expenseRepo.listVoided(db, window.from, window.to),
    ]);

    const items: AuditItem[] = [
      ...events.map((e) => ({
        id: e.id,
        kind: (e.action === 'voided' ? 'job_void' : 'payment_change') as AuditKind,
        at: e.createdAt.toISOString(),
        by: e.user,
        reason: e.reason,
        amount: e.job.total,
        title: e.job.vehicle.registrationNumber,
        subtitle: e.job.customer.name ?? e.job.customer.phone,
        fromValue: e.fromValue,
        toValue: e.toValue,
        jobId: e.job.id,
      })),
      ...voidedExpenses.map((x) => ({
        id: x.id,
        kind: 'expense_void' as AuditKind,
        at: (x.voidedAt ?? x.createdAt).toISOString(),
        by: x.voidedBy ?? x.createdBy,
        reason: x.voidReason,
        amount: x.amount,
        title: x.category,
        subtitle: x.description ?? `Entered by ${x.createdBy.name}`,
        fromValue: null,
        toValue: null,
        jobId: null,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return c.json({ ...windowMeta(query, window), items });
  });
