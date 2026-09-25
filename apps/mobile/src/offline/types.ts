import type { ExpenseCategory, JobStatus, PaymentMethod, VehicleCategory } from '@mana/domain';

/** A job row as the Job Board / Job Detail render it (API JSON, dates as ISO strings). */
export interface BoardJob {
  id: string;
  status: JobStatus;
  subtotal: number;
  discount: number;
  discountReason?: string | null;
  total: number;
  createdAt: string;
  paymentMethod: PaymentMethod | null;
  customer: { id: string; name: string | null; phone: string };
  vehicle: { registrationNumber: string; vehicleType: { name: string; category?: string } };
  jobServices: { quantity: number; priceAtTime: number; service: { name: string } }[];
  createdBy: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
  /** Set only on the phone: this row (or its latest change) hasn't reached the server yet. */
  syncState?: 'pending' | 'failed';
}

export interface StartJobPayload {
  id: string;
  occurredAt: string;
  customer: { phone: string; name: string };
  registrationNumber: string;
  /** Known plate, different phone: whether the owner changed numbers or the vehicle changed hands. */
  ownership?: 'new_owner' | 'same_person';
  vehicleTypeId: string;
  services: { serviceId: string; quantity: number }[];
  discount: number;
  discountReason?: string;
  /** Comeback coupon; the server works out the discount. Never queued offline. */
  couponCode?: string;
}

/** What the board needs to show a queued New Wash before the server has priced it. */
export interface StartJobMeta {
  vehicleTypeName: string;
  vehicleCategory: VehicleCategory;
  services: { name: string; price: number }[];
  subtotal: number;
  total: number;
}

export interface ExpensePayload {
  id: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  date?: string;
}

export type OutboxOp =
  | { kind: 'job.start'; payload: StartJobPayload; meta: StartJobMeta }
  | {
      kind: 'job.status';
      payload: { jobId: string; status: 'washing' | 'ready'; occurredAt: string };
    }
  | {
      kind: 'job.pay';
      payload: { jobId: string; paymentMethod: PaymentMethod; occurredAt: string };
    }
  | { kind: 'job.void'; payload: { jobId: string; reason: string; occurredAt: string } }
  | { kind: 'expense.create'; payload: ExpensePayload };

export interface OutboxItem {
  id: string;
  /** Only the person who made a change can sync it — it goes out under their session. */
  userId: string;
  userName: string;
  createdAt: string;
  attempts: number;
  state: 'pending' | 'failed';
  error?: string;
  op: OutboxOp;
}

export function opJobId(op: OutboxOp): string | null {
  if (op.kind === 'job.start') return op.payload.id;
  if (op.kind === 'expense.create') return null;
  return op.payload.jobId;
}

export function describeOp(op: OutboxOp): string {
  switch (op.kind) {
    case 'job.start':
      return `New wash · ${op.payload.registrationNumber}`;
    case 'job.status':
      return op.payload.status === 'washing' ? 'Start wash' : 'Mark ready';
    case 'job.pay':
      return `Mark paid (${op.payload.paymentMethod.toUpperCase()})`;
    case 'job.void':
      return 'Void job';
    case 'expense.create':
      return 'Expense entry';
  }
}
