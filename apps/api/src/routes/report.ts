import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { expenseRepo, jobRepo, opsRepo } from '@mana/db';
import { daysWorked, EXPENSE_CATEGORY_LABEL, type AttendanceStatus, type ExpenseCategory } from '@mana/domain';
import { cashHeldNow } from '../lib/cashHeld';
import { requireAuth, requireRole } from '../middleware/auth';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import type { Env } from '../types';
import { windowDates } from './shop';

type AuditKind = 'job_void' | 'payment_change' | 'expense_void' | 'expense_edit' | 'handover_undo' | 'drawer_reopen';

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

const EDIT_FIELD_LABEL: Record<string, string> = {
  amount: 'Amount',
  category: 'Category',
  itemName: 'Item',
  quantity: 'Quantity',
  unit: 'Unit',
  description: 'Note',
  paymentMethod: 'Paid with',
  cashSource: 'Paid from',
  date: 'Date',
};

const CASH_SOURCE_LABEL: Record<string, string> = { drawer: 'Shop cash box', held: 'Doorstep cash' };

/** "Amount: ₹1,200" — one side of an expense edit, readable in the corrections feed. */
function describeChange(field: string, value: unknown): string {
  const label = EDIT_FIELD_LABEL[field] ?? field;
  if (value == null || value === '') return `${label}: —`;
  if (field === 'amount' && typeof value === 'number') return `${label}: ₹${(value / 100).toLocaleString('en-IN')}`;
  if (field === 'category') return `${label}: ${EXPENSE_CATEGORY_LABEL[value as ExpenseCategory] ?? String(value)}`;
  if (field === 'cashSource') return `${label}: ${CASH_SOURCE_LABEL[String(value)] ?? String(value)}`;
  return `${label}: ${String(value)}`;
}

// Owner-only team reports. Chained in one expression, with every input declared via
// `zValidator` — see the comment in routes/auth.ts for why both matter for Hono RPC's typing.
export const reportRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  // Per-person washes started, money collected (by method), voids, and payment corrections.
  .get('/staff', zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const { fromDate, toDate } = windowDates(window.from, window.to);
    const [rows, attendance, held, short] = await Promise.all([
      jobRepo.getStaffStats(db, window.from, window.to),
      opsRepo.listAttendance(db, fromDate, toDate),
      cashHeldNow(db),
      opsRepo.handoverShortByCollector(db, window.from, window.to),
    ]);
    const statusesByUser = new Map<string, AttendanceStatus[]>();
    for (const a of attendance) {
      const list = statusesByUser.get(a.userId) ?? [];
      list.push(a.status as AttendanceStatus);
      statusesByUser.set(a.userId, list);
    }
    return c.json({
      ...windowMeta(query, window),
      rows: rows.map((r) => {
        const statuses = statusesByUser.get(r.userId) ?? [];
        return {
          ...r,
          /** Doorstep cash they hold right now, from any day. */
          doorstepHeld: held.get(r.userId) ?? 0,
          /** Doorstep cash they handed in short in this period. */
          doorstepShort: short.get(r.userId) ?? 0,
          attendance: {
            present: statuses.filter((s) => s === 'present').length,
            half: statuses.filter((s) => s === 'half').length,
            absent: statuses.filter((s) => s === 'absent').length,
            daysWorked: daysWorked(statuses),
          },
        };
      }),
    });
  })
  // One chronological feed of every money correction: voided jobs, payment-method changes,
  // and voided expenses — each with who did it and the reason they gave.
  .get('/audit', zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const [events, voidedExpenses, expenseEdits, undoneHandovers, reopens] = await Promise.all([
      jobRepo.listCorrections(db, window.from, window.to),
      expenseRepo.listVoided(db, window.from, window.to),
      expenseRepo.listEdits(db, window.from, window.to),
      opsRepo.listVoidedHandovers(db, window.from, window.to),
      opsRepo.listReopens(db, window.from, window.to),
    ]);
    const someone = { id: '', name: 'Someone' };

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
        subtitle: x.itemName ?? x.description ?? `Entered by ${x.createdBy.name}`,
        fromValue: null,
        toValue: null,
        jobId: null,
      })),
      ...expenseEdits.map((x) => ({
        id: x.id,
        kind: 'expense_edit' as AuditKind,
        at: x.createdAt.toISOString(),
        by: x.editedBy,
        reason: x.reason,
        amount: x.expense.amount,
        title: x.expense.category,
        subtitle: x.expense.itemName ?? x.expense.description ?? 'Expense',
        fromValue: x.changes.map((ch) => describeChange(ch.field, ch.from)).join(' · '),
        toValue: x.changes.map((ch) => describeChange(ch.field, ch.to)).join(' · '),
        jobId: null,
      })),
      ...undoneHandovers.map((h) => ({
        id: `handover:${h.id}`,
        kind: 'handover_undo' as AuditKind,
        at: (h.voidedAt ?? h.createdAt).toISOString(),
        by: h.voidedBy ?? someone,
        reason: h.voidReason,
        amount: h.received,
        title: `Doorstep cash from ${h.collector}`,
        subtitle: `Handed in ${h.date}`,
        fromValue: null,
        toValue: null,
        jobId: null,
      })),
      ...reopens.map((r) => ({
        id: `reopen:${r.id}`,
        kind: 'drawer_reopen' as AuditKind,
        at: (r.reopenedAt ?? r.closedAt).toISOString(),
        by: r.reopenedBy ?? someone,
        reason: r.reopenReason,
        amount: r.counted ?? 0,
        title: `Cash drawer ${r.date}`,
        subtitle:
          r.counted != null && r.expected != null && r.counted !== r.expected
            ? `Was closed ${r.counted < r.expected ? 'short' : 'over'} by ₹${(Math.abs(r.counted - r.expected) / 100).toLocaleString('en-IN')}`
            : 'Was closed matching',
        fromValue: null,
        toValue: null,
        jobId: null,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return c.json({ ...windowMeta(query, window), items });
  });
