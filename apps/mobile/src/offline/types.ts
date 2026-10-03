import type { ExpenseCategory, ExpenseUnit, JobStatus, PaymentMethod, StockUnit, VehicleCategory } from '@mana/domain';

/** One car's stamp card for one service (API `RewardCardView`, dates as ISO strings). */
export interface RewardCard {
  serviceId: string;
  serviceName: string;
  every: number;
  stamps: number;
  free: number;
  lastVisitAt: string | null;
  /** When the card resets unless the car gets this service again; null = nothing to lose. */
  expiresAt: string | null;
}

/** A welcome-gift item owed to, or handed over to, a car (API `RewardGiftView`). */
export interface RewardGift {
  id: string;
  jobId: string;
  vehicleId: string;
  customerId: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  quantity: number;
  status: 'owed' | 'given' | 'cancelled';
  createdAt: string;
  givenAt: string | null;
  givenBy: { id: string; name: string } | null;
}

/** The welcome gift written on a car's first paid wash, as the board shows it. */
export interface BoardGift {
  id: string;
  stockItemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  status: string;
}

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
  jobServices: {
    serviceId?: string;
    quantity: number;
    priceAtTime: number;
    commissionAtTime?: number;
    service: { name: string };
  }[];
  /** Services on this bill given free from the car's stamp card. */
  freeServiceIds?: string[];
  /** Welcome gift written when this (first) wash was paid. */
  gifts?: BoardGift[];
  /** Gifts this car is still owed from any visit (out of stock at the time). */
  giftsOwedForCar?: BoardGift[];
  createdBy: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
  washers?: { user: { id: string; name: string } }[];
  /** Who got the customer to take a commission service; they share its commission. */
  sellers?: { user: { id: string; name: string } }[];
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
  /** Signed referral quote; the server re-checks it and applies the discount. Never queued offline. */
  referralToken?: string;
  /** Free washes from the car's stamp cards; the server re-checks every one. Never queued offline. */
  rewardServiceIds?: string[];
  /** Who got this service, when a picked service pays commission. Defaults to whoever enters it. */
  sellerIds?: string[];
}

/** What the board needs to show a queued New Wash before the server has priced it. */
export interface StartJobMeta {
  vehicleTypeName: string;
  vehicleCategory: VehicleCategory;
  services: { name: string; price: number; commission?: number }[];
  subtotal: number;
  total: number;
  sellers?: { id: string; name: string }[];
}

export interface ExpensePayload {
  id: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  itemName?: string;
  quantity?: number;
  unit?: ExpenseUnit;
  date?: string;
  paymentMethod?: ExpensePaymentMethod;
  /** Add the quantity to the stock item with the same name (the server creates it if new). */
  addToStock?: boolean;
  /** Local copies on this phone (see offline/photoFiles); uploaded with the entry in one request. */
  billPhoto: LocalPhoto;
  itemPhoto: LocalPhoto;
}

export interface LocalPhoto {
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
}

export type ExpensePaymentMethod = 'cash' | 'upi' | 'other';

/** Stock taken off the shelf, added, or counted. `quantity` is in the unit it was typed in. */
export interface StockMovePayload {
  id: string;
  itemId: string;
  kind: 'use' | 'in' | 'count';
  quantity: number;
  unit: ExpenseUnit;
  note?: string;
}

export interface PhotoPayload {
  id: string;
  jobId: string;
  kind: 'before' | 'after';
  /** A copy in the app's own storage, so it survives until the upload lands. */
  uri: string;
  contentType: string;
  occurredAt: string;
}

export type OutboxOp =
  | { kind: 'job.start'; payload: StartJobPayload; meta: StartJobMeta }
  | {
      kind: 'job.status';
      payload: { jobId: string; status: 'washing' | 'ready'; occurredAt: string; washerIds?: string[] };
      /** Names for the board while the change is still on this phone. */
      meta?: { washers: { id: string; name: string }[] };
    }
  | {
      kind: 'job.washers';
      payload: { jobId: string; washerIds: string[]; occurredAt: string };
      meta: { washers: { id: string; name: string }[] };
    }
  | {
      kind: 'job.sellers';
      payload: { jobId: string; sellerIds: string[]; occurredAt: string };
      meta: { sellers: { id: string; name: string }[] };
    }
  | {
      kind: 'job.pay';
      payload: { jobId: string; paymentMethod: PaymentMethod; occurredAt: string };
    }
  | { kind: 'job.void'; payload: { jobId: string; reason: string; occurredAt: string } }
  | { kind: 'photo.upload'; payload: PhotoPayload }
  | { kind: 'expense.create'; payload: ExpensePayload }
  | { kind: 'stock.move'; payload: StockMovePayload; meta: { itemName: string } };

export interface OutboxItem {
  id: string;
  /** Only the person who made a change can sync it — it goes out under their session. */
  userId: string;
  userName: string;
  createdAt: string;
  /** Server-side failures so far (5xx, rate limits); network drops don't count. */
  attempts: number;
  /** After a server-side failure, wait until this time (ms) before trying again. */
  nextAttemptAt?: number;
  state: 'pending' | 'failed';
  error?: string;
  op: OutboxOp;
}

export function opJobId(op: OutboxOp): string | null {
  if (op.kind === 'job.start') return op.payload.id;
  if (op.kind === 'expense.create' || op.kind === 'stock.move') return null;
  return op.payload.jobId;
}

export function describeOp(op: OutboxOp): string {
  switch (op.kind) {
    case 'job.start':
      return `New wash · ${op.payload.registrationNumber}`;
    case 'job.status':
      return op.payload.status === 'washing' ? 'Start wash' : 'Mark ready';
    case 'job.washers':
      return 'Change washers';
    case 'job.sellers':
      return 'Change who got the service';
    case 'job.pay':
      return `Mark paid (${op.payload.paymentMethod.toUpperCase()})`;
    case 'job.void':
      return 'Void job';
    case 'photo.upload':
      return `${op.payload.kind === 'before' ? 'Before' : 'After'} photo`;
    case 'expense.create':
      return 'Expense entry';
    case 'stock.move':
      return `${op.payload.kind === 'use' ? 'Stock used' : op.payload.kind === 'count' ? 'Stock count' : 'Stock added'} · ${op.meta.itemName}`;
  }
}
