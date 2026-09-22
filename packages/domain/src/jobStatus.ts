import type { JobStatus } from './types';

const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  waiting: ['washing', 'void'],
  washing: ['ready', 'void'],
  ready: ['paid', 'void'],
  paid: [],
  void: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidJobTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Cannot transition job from "${from}" to "${to}"`);
    this.name = 'InvalidJobTransitionError';
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}
