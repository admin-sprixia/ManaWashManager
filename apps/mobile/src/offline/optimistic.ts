import type { BoardJob, OutboxItem } from './types';

/**
 * The board shows the server's jobs with the phone's unsynced changes laid on top, so a
 * wash started or paid with no signal looks done immediately. Rows touched by a queued
 * change are flagged so the UI can show they're still waiting to sync.
 */
export function applyOutbox(jobs: BoardJob[], items: OutboxItem[]): BoardJob[] {
  const byId = new Map(jobs.map((j) => [j.id, { ...j }]));
  const order = jobs.map((j) => j.id);

  for (const item of items) {
    const { op } = item;
    const flag = item.state === 'failed' ? 'failed' : 'pending';

    if (op.kind === 'job.start') {
      if (byId.has(op.payload.id)) continue; // already on the server
      byId.set(op.payload.id, {
        id: op.payload.id,
        status: 'waiting',
        subtotal: op.meta.subtotal,
        discount: op.payload.discount,
        discountReason: op.payload.discountReason ?? null,
        total: op.meta.total,
        createdAt: op.payload.occurredAt,
        paymentMethod: null,
        customer: { id: '', name: op.payload.customer.name, phone: op.payload.customer.phone },
        vehicle: {
          registrationNumber: op.payload.registrationNumber,
          vehicleType: { name: op.meta.vehicleTypeName, category: op.meta.vehicleCategory },
        },
        jobServices: op.meta.services.map((s) => ({ quantity: 1, priceAtTime: s.price, service: { name: s.name } })),
        createdBy: { id: item.userId, name: item.userName },
        paidBy: null,
        syncState: flag,
      });
      order.unshift(op.payload.id);
      continue;
    }

    if (op.kind === 'expense.create') continue;
    const job = byId.get(op.payload.jobId);
    if (!job) continue;
    if (item.state === 'failed') {
      job.syncState = 'failed';
      continue;
    }

    if (op.kind === 'job.status') job.status = op.payload.status;
    if (op.kind === 'job.pay') {
      job.status = 'paid';
      job.paymentMethod = op.payload.paymentMethod;
      job.paidBy = { id: item.userId, name: item.userName };
    }
    if (op.kind === 'job.void') job.status = 'void';
    job.syncState = job.syncState === 'failed' ? 'failed' : 'pending';
  }

  return order.map((id) => byId.get(id)!).filter(Boolean);
}
