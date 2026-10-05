import type { ProFeature } from '@mana/domain';

/** The API refused because of the shop's plan (HTTP 402): a Pro feature, or a Free limit. */
export type PlanRefusal =
  | { kind: 'feature'; feature: ProFeature; message?: string }
  | { kind: 'washLimit'; message?: string }
  | { kind: 'staffLimit'; message?: string };

/** Reads a 402 body into a PlanRefusal; null for any other reply. */
export function planRefusalFrom(status: number, body: unknown): PlanRefusal | null {
  if (status !== 402) return null;
  const b = (body ?? {}) as { error?: string; feature?: ProFeature; message?: string };
  if (b.error === 'plan_wash_limit') return { kind: 'washLimit', message: b.message };
  if (b.error === 'plan_staff_limit') return { kind: 'staffLimit', message: b.message };
  return { kind: 'feature', feature: b.feature ?? 'fullReports', message: b.message };
}
