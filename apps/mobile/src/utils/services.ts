import type { Service } from '@mana/domain';
import type { ServiceGroup } from '../components/ServicePickRow';

export const SERVICE_GROUP_ORDER: ServiceGroup[] = ['Combos', 'Wash', 'Interior', 'Protect', 'Add-ons', 'Other'];

/** Buckets a service into a menu group (combos first, the rest by name), so long catalogs read as short sections. */
export function groupForService(service: Pick<Service, 'name' | 'includes'>): ServiceGroup {
  if ((service.includes?.length ?? 0) > 0) return 'Combos';
  const n = service.name.toLowerCase();
  if (/combo|wash|exterior|underbody|foam|degrease|chain/.test(n)) return 'Wash';
  if (/interior|cabin|seat|vacuum/.test(n) || n.startsWith('ac') || n.includes('ac ')) return 'Interior';
  if (/ceramic|coat|polish|wax|teflon|ppf/.test(n)) return 'Protect';
  if (/tyre|tire|dashboard|fragrance|dressing|lube|perfume/.test(n)) return 'Add-ons';
  return 'Other';
}

export function normalizeReg(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
