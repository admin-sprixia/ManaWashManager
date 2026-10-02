import type { JobStatus } from '@mana/domain';
import type { BoardJob } from '../offline/types';

export const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: 'Waiting',
  washing: 'Washing',
  ready: 'Ready',
  paid: 'Paid',
  void: 'Void',
};

export const NEXT_STATUS: Partial<Record<JobStatus, 'washing' | 'ready'>> = {
  waiting: 'washing',
  washing: 'ready',
};

export const VOID_REASONS = [
  'Entered by mistake',
  'Duplicate entry',
  'Customer left before the wash',
  'Wrong vehicle or services',
];

/** Walk-ins are stored as `WALK-IN-<timestamp>` for uniqueness — never show that raw string. */
export function vehicleHeadline(job: Pick<BoardJob, 'vehicle'>): { title: string; meta: string } {
  const typeName = job.vehicle.vehicleType.name;
  const reg = job.vehicle.registrationNumber;
  if (reg.startsWith('WALK-IN')) return { title: typeName, meta: 'Walk-in' };
  return { title: reg, meta: typeName };
}

export function customerLine(job: Pick<BoardJob, 'customer'>): string {
  return job.customer.name?.trim() || job.customer.phone;
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? '';
}

/** "Ravi", "Ravi + Anil", "Ravi + 2" — who's washing, short enough for a board row. */
export function washerNames(job: Pick<BoardJob, 'washers'>): string | null {
  const names = (job.washers ?? []).map((w) => firstName(w.user.name));
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(' + ');
  return `${names[0]} + ${names.length - 1}`;
}

export function formatTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function isToday(input: string | Date): boolean {
  const date = typeof input === 'string' ? new Date(input) : input;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return date.getTime() >= start.getTime();
}

export function actionLabel(status: JobStatus): string | null {
  if (status === 'waiting') return 'Start wash';
  if (status === 'washing') return 'Mark ready';
  if (status === 'ready') return 'Mark paid';
  return null;
}
