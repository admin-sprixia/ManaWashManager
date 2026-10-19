import { BODY_TYPES, type JobStatus } from '@mana/domain';
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

type JobVehicle = BoardJob['vehicle'];

export function vehicleBodyKey(vt: JobVehicle['vehicleType']): string | null {
  if (vt.bodyKey) return vt.bodyKey;
  return vt.bodyTypeId ? (BODY_TYPES.find((b) => vt.bodyTypeId!.endsWith(`_${b.key}`))?.key ?? null) : null;
}

/** "Maruti Suzuki Swift", or null when the model isn't known. */
export function vehicleModelLine(vehicle: JobVehicle): string | null {
  const make = vehicle.make?.trim();
  const model = vehicle.model?.trim();
  if (!make || !model) return null;
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

export function isWalkIn(vehicle: JobVehicle): boolean {
  return vehicle.registrationNumber.startsWith('WALK-IN');
}

/** "AP39AB1234" → "AP 39 AB 1234", the way it's painted on the plate. */
export function spacedPlate(reg: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(reg);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : reg;
}

/** "Foam Wash + Wax", "Foam Wash + 2 more" — what's being done, short enough for a row. */
export function servicesLine(job: Pick<BoardJob, 'jobServices'>, max = 2): string {
  const names = job.jobServices.map((l) => l.service.name).filter((n) => n !== 'Visit charge');
  if (names.length === 0) return 'No services';
  if (names.length <= max) return names.join(' + ');
  return `${names.slice(0, max - 1).join(' + ')} + ${names.length - max + 1} more`;
}

/** Walk-ins are stored as `WALK-IN-<timestamp>` for uniqueness — never show that raw string. */
export function vehicleHeadline(job: Pick<BoardJob, 'vehicle'>): { title: string; meta: string } {
  const model = vehicleModelLine(job.vehicle);
  const reg = job.vehicle.registrationNumber;
  if (isWalkIn(job.vehicle)) return { title: model ?? 'Walk-in', meta: model ? 'Walk-in' : '' };
  return { title: reg, meta: model ?? '' };
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

/** IST midnight (same clock as the API board / reports), not the phone's local timezone. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function startOfIstDay(reference = new Date()): Date {
  const ist = new Date(reference.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** True when `input` falls on today's IST calendar day. */
export function isToday(input: string | Date): boolean {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.getTime() >= startOfIstDay().getTime();
}

/** Day a paid job counts on the board / reports: payment time, else open time. */
export function activityAt(job: Pick<BoardJob, 'createdAt' | 'completedAt' | 'status'>): string {
  if (job.status === 'paid' && job.completedAt) return job.completedAt;
  return job.createdAt;
}

export function actionLabel(status: JobStatus): string | null {
  if (status === 'waiting') return 'Start wash';
  if (status === 'washing') return 'Mark ready';
  if (status === 'ready') return 'Mark paid';
  return null;
}
