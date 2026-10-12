import { SINGLE_PER_WEEK, installmentPlan, type PayMode } from '@mana/domain';
import type { MenuPlan, MenuService, PlaceInfo, PlaceMenu } from '../api/types';

/** What one vehicle gets: a plan (paid in full or in parts) or a one-time wash with extras. */
export type Choice = { kind: 'plan'; planId: string; payMode: PayMode } | { kind: 'single'; serviceIds: string[] };

export interface PricedPlan {
  plan: MenuPlan;
  perWash: number;
  total: number;
}

export interface PricedService {
  service: MenuService;
  price: number;
}

/** The plans this vehicle type can have here, with its prices. */
export function plansFor(menu: PlaceMenu, vehicleTypeId: string): PricedPlan[] {
  return menu.plans.flatMap((plan) => {
    const price = plan.prices.find((p) => p.vehicleTypeId === vehicleTypeId);
    return price ? [{ plan, perWash: price.perWash, total: price.total }] : [];
  });
}

/** The one-time services this vehicle type can have here, with its prices. */
export function servicesFor(menu: PlaceMenu, vehicleTypeId: string): PricedService[] {
  return menu.services.flatMap((service) => {
    const price = service.prices.find((p) => p.vehicleTypeId === vehicleTypeId);
    return price ? [{ service, price: price.price }] : [];
  });
}

/** Whether the team washes this vehicle type at the place at all. */
export const servesType = (menu: PlaceMenu, vehicleTypeId: string) =>
  plansFor(menu, vehicleTypeId).length > 0 || servicesFor(menu, vehicleTypeId).length > 0;

/** "Most popular" already ticked (plans open first); a one-time wash when there are no plans. */
export function defaultChoice(menu: PlaceMenu, vehicleTypeId: string): Choice | null {
  const plans = plansFor(menu, vehicleTypeId);
  const plan = plans.find((p) => p.plan.popular) ?? plans[0];
  if (plan) return { kind: 'plan', planId: plan.plan.id, payMode: 'full' };
  const service = servicesFor(menu, vehicleTypeId)[0];
  return service ? { kind: 'single', serviceIds: [service.service.id] } : null;
}

export interface ChoiceSummary {
  title: string;
  total: number;
  /** Paid before the first wash: everything, or the first part. */
  firstPayment: number;
  /** Washes a week, for the first wash day. */
  perWeek: number;
}

export function summarize(info: PlaceInfo, vehicleTypeId: string, choice: Choice): ChoiceSummary | null {
  if (choice.kind === 'plan') {
    const priced = plansFor(info.menu, vehicleTypeId).find((p) => p.plan.id === choice.planId);
    if (!priced) return null;
    const payMode = priced.plan.allowParts ? choice.payMode : 'full';
    const parts = partsFor(info, priced, payMode);
    return { title: `${priced.plan.name} plan`, total: priced.total, firstPayment: parts[0]?.amount ?? priced.total, perWeek: priced.plan.perWeek };
  }
  const picked = servicesFor(info.menu, vehicleTypeId).filter((s) => choice.serviceIds.includes(s.service.id));
  if (!picked.length) return null;
  const total = picked.reduce((n, s) => n + s.price, 0);
  return { title: picked.map((s) => s.service.name).join(' + '), total, firstPayment: total, perWeek: SINGLE_PER_WEEK };
}

/** The parts of a plan as the server will make them (the dates are placeholders until joined). */
export function partsFor(info: PlaceInfo, priced: PricedPlan, payMode: PayMode) {
  return installmentPlan({
    total: priced.total,
    mode: payMode,
    firstDueOn: info.firstWash[String(priced.plan.perWeek)]?.day ?? '2000-01-01',
    months: priced.plan.months,
    rules: info.rules,
  });
}
