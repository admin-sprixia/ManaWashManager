import type { ServiceGroup } from '../components/ServicePickRow';

export const SERVICE_GROUP_ORDER: ServiceGroup[] = ['Wash', 'Interior', 'Protect', 'Add-ons', 'Other'];

/** Buckets a service into a menu group by name, so long catalogs read as short sections. */
export function groupForService(name: string): ServiceGroup {
  const n = name.toLowerCase();
  if (/combo|wash|exterior|underbody|foam|degrease|chain/.test(n)) return 'Wash';
  if (/interior|cabin|seat|vacuum/.test(n) || n.startsWith('ac') || n.includes('ac ')) return 'Interior';
  if (/ceramic|coat|polish|wax|teflon|ppf/.test(n)) return 'Protect';
  if (/tyre|tire|dashboard|fragrance|dressing|lube|perfume/.test(n)) return 'Add-ons';
  return 'Other';
}

export function normalizeReg(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
