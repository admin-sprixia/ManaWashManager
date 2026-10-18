import { MAX_SERVICE_PRICE_PAISE } from './pricing';
import type { ServiceAppliesTo } from './types';
import { categoryForClass, type VehicleClassKey } from './vehicleCatalog';

/**
 * The service network: a business owns one catalog (services, base prices by vehicle class and
 * size, pricing rules); its branches own service points (a hub, doorstep teams) that say how and
 * what they wash. Each branch's menu — the services and prices staff and customers see — is
 * planned from those, so a price changed once at the top reaches every branch.
 */

/** How a wash is delivered. */
export type DeliveryMode = 'hub' | 'doorstep';
export const DELIVERY_MODES: readonly DeliveryMode[] = ['hub', 'doorstep'];

/** Where a catalog service can be done (underbody needs the hub's ramp, so it's hub-only). */
export type ServiceModes = DeliveryMode | 'both';
export const SERVICE_MODES: readonly ServiceModes[] = ['hub', 'doorstep', 'both'];

/** Kinds of service point a branch can run. */
export type ServicePointKind = DeliveryMode;

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return value === 'hub' || value === 'doorstep';
}

export function parseServiceModes(value: string | null | undefined): ServiceModes {
  return value === 'doorstep' || value === 'both' ? value : 'hub';
}

export function serviceModesInclude(modes: ServiceModes, mode: DeliveryMode): boolean {
  return modes === 'both' || modes === mode;
}

export const DELIVERY_MODE_LABEL: Readonly<Record<DeliveryMode, string>> = {
  hub: 'At the hub',
  doorstep: 'Doorstep',
};

// ─── Where a service is done ────────────────────────────────────────────────

/**
 * A branch sells at three places: its shop, communities, and customers' homes (doorstep). The
 * community team does both communities and homes, so a service is stored as `modes` (shop, team
 * or both — what prices it gets) plus `teamAt` (where the team does it). Community and doorstep
 * share the team's price.
 */
export type TeamPlaces = 'both' | 'community' | 'doorstep';
export const TEAM_PLACES: readonly TeamPlaces[] = ['both', 'community', 'doorstep'];

export function parseTeamPlaces(value: string | null | undefined): TeamPlaces {
  return value === 'community' || value === 'doorstep' ? value : 'both';
}

export interface ServicePlaces {
  shop: boolean;
  community: boolean;
  doorstep: boolean;
}

export function servicePlaces(modes: ServiceModes, teamAt: TeamPlaces): ServicePlaces {
  const team = modes !== 'hub';
  return {
    shop: modes !== 'doorstep',
    community: team && teamAt !== 'doorstep',
    doorstep: team && teamAt !== 'community',
  };
}

/** The stored form of three ticks; null when none is ticked (a service has to be done somewhere). */
export function placesToModes(places: ServicePlaces): { modes: ServiceModes; teamAt: TeamPlaces } | null {
  const team = places.community || places.doorstep;
  if (!places.shop && !team) return null;
  const modes: ServiceModes = places.shop && team ? 'both' : places.shop ? 'hub' : 'doorstep';
  const teamAt: TeamPlaces = !team || (places.community && places.doorstep) ? 'both' : places.community ? 'community' : 'doorstep';
  return { modes, teamAt };
}

export const SERVICE_PLACE_LABEL: Readonly<Record<keyof ServicePlaces, string>> = {
  shop: 'Shop',
  community: 'Community',
  doorstep: 'Doorstep',
};

/** "Shop only", "Shop & community", "Shop, community & doorstep". */
export function servicePlacesLabel(places: ServicePlaces): string {
  const on = (Object.keys(SERVICE_PLACE_LABEL) as (keyof ServicePlaces)[]).filter((k) => places[k]);
  if (on.length === 1) return `${SERVICE_PLACE_LABEL[on[0]!]} only`;
  const names = on.map((k, i) => (i === 0 ? SERVICE_PLACE_LABEL[k] : SERVICE_PLACE_LABEL[k].toLowerCase()));
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// ─── Service details ────────────────────────────────────────────────────────

/** What kind of service it is: groups the menu (washes first, then protection, then add-ons). */
export type ServiceKind = 'wash' | 'protection' | 'addon';
export const SERVICE_KINDS: readonly ServiceKind[] = ['wash', 'protection', 'addon'];
export const SERVICE_KIND_LABEL: Readonly<Record<ServiceKind, string>> = {
  wash: 'Wash',
  protection: 'Protection',
  addon: 'Add-on',
};

export function parseServiceKind(value: string | null | undefined): ServiceKind {
  return value === 'protection' || value === 'addon' ? value : 'wash';
}

/** How long a service takes, in minutes: from 1 minute up to 30 days (a long coating or repair). */
export const SERVICE_DURATION_MAX_MIN = 30 * 24 * 60;

/** The units a service's time is entered in. */
export type DurationUnit = 'min' | 'hr' | 'day';
export const DURATION_UNIT_MINUTES: Readonly<Record<DurationUnit, number>> = { min: 1, hr: 60, day: 24 * 60 };
export const DURATION_UNIT_LABEL: Readonly<Record<DurationUnit, string>> = { min: 'Minutes', hr: 'Hours', day: 'Days' };

/** A stored time shown in its biggest whole unit: 2880 → 2 days, 90 → 90 minutes, 120 → 2 hours. */
export function durationParts(minutes: number): { amount: number; unit: DurationUnit } {
  if (minutes % DURATION_UNIT_MINUTES.day === 0) return { amount: minutes / DURATION_UNIT_MINUTES.day, unit: 'day' };
  if (minutes % DURATION_UNIT_MINUTES.hr === 0) return { amount: minutes / DURATION_UNIT_MINUTES.hr, unit: 'hr' };
  return { amount: minutes, unit: 'min' };
}
/** "What's included" checklist: up to 12 short lines. */
export const SERVICE_CHECKLIST_MAX = 12;
export const SERVICE_CHECKLIST_ITEM_MAX = 40;

/** A stored checklist (JSON list of lines); anything unreadable is an empty list. */
export function parseChecklist(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, SERVICE_CHECKLIST_MAX) : [];
  } catch {
    return [];
  }
}

/** "20 min", "1 hr", "1 hr 15 min", "2 days", "1 day 6 hr". */
export function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / DURATION_UNIT_MINUTES.day);
  const h = Math.floor((minutes % DURATION_UNIT_MINUTES.day) / 60);
  const m = minutes % 60;
  if (d) return h ? `${d} day${d === 1 ? '' : 's'} ${h} hr` : `${d} day${d === 1 ? '' : 's'}`;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Comma-separated text → checklist lines: trimmed, empty ones dropped, no repeats (any case). */
export function splitChecklist(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const line = part.trim().replace(/\s+/g, ' ');
    if (line && !out.some((x) => x.toLowerCase() === line.toLowerCase())) out.push(line);
  }
  return out;
}

// ─── Pricing rules ──────────────────────────────────────────────────────────

/** Basis points: 10000 = 100%. Whole numbers keep money maths exact. */
export const BP_PER_PERCENT = 100;
export const MAX_ADJUSTMENT_BP = 200 * BP_PER_PERCENT;
export const MIN_ADJUSTMENT_BP = -90 * BP_PER_PERCENT;
export const MAX_ADJUSTMENT_FIXED_PAISE = 10_000 * 100;

/** Extra for delivering a service another way (doorstep: travel + water). */
export interface ModeAdjustment {
  mode: DeliveryMode;
  /** Null = every class; a class-specific rule wins over the all-classes one. */
  classKey: string | null;
  percentBp: number;
  fixedPaise: number;
  /** The extra is at least this much (0 = no floor). */
  minExtraPaise: number;
}

/** The business's pricing policy, editable from the admin side at any time. */
export interface PricingPolicy {
  /** Every list price is rounded to the nearest rupee (fixed: prices like ₹499 stay ₹499). */
  roundToPaise: number;
  /** Branch owners may set their own price for a service and vehicle. */
  branchOverrides: boolean;
  /** How far a branch price may go above / below the list price, in percent. */
  maxIncreasePct: number;
  maxDecreasePct: number;
  /** Branch owners may stop offering a catalog service at their branch. */
  branchCanHideServices: boolean;
}

/** Worked-out prices (₹474.05 by the community rule) are rounded to the rupee. */
export const PRICE_ROUND_PAISE = 100;

export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  roundToPaise: PRICE_ROUND_PAISE,
  branchOverrides: true,
  maxIncreasePct: 20,
  maxDecreasePct: 20,
  branchCanHideServices: true,
};

export const MAX_OVERRIDE_PCT = 100;

/** Reads stored policy values (strings from a settings table), falling back field by field. */
export function parsePricingPolicy(raw: Partial<Record<keyof PricingPolicy, string | null | undefined>>): PricingPolicy {
  const int = (v: string | null | undefined, min: number, max: number, fallback: number) => {
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const bool = (v: string | null | undefined, fallback: boolean) =>
    v === 'true' ? true : v === 'false' ? false : fallback;
  const d = DEFAULT_PRICING_POLICY;
  return {
    roundToPaise: PRICE_ROUND_PAISE,
    branchOverrides: bool(raw.branchOverrides, d.branchOverrides),
    maxIncreasePct: int(raw.maxIncreasePct, 0, MAX_OVERRIDE_PCT, d.maxIncreasePct),
    maxDecreasePct: int(raw.maxDecreasePct, 0, MAX_OVERRIDE_PCT, d.maxDecreasePct),
    branchCanHideServices: bool(raw.branchCanHideServices, d.branchCanHideServices),
  };
}

export function roundPaise(value: number, step: number): number {
  const s = step > 0 ? step : 1;
  return Math.round(value / s) * s;
}

function clampPrice(value: number): number {
  return Math.min(MAX_SERVICE_PRICE_PAISE, Math.max(0, Math.round(value)));
}

/** The rule that applies: a class-specific one beats the all-classes one; none = no extra. */
export function modeAdjustmentFor(
  adjustments: readonly ModeAdjustment[],
  mode: DeliveryMode,
  classKey: string,
): ModeAdjustment | null {
  return (
    adjustments.find((a) => a.mode === mode && a.classKey === classKey) ??
    adjustments.find((a) => a.mode === mode && a.classKey == null) ??
    null
  );
}

export interface PriceStep {
  label: string;
  /** Change in paise this step made (the base step carries the base price). */
  amount: number;
}

export interface ListPrice {
  price: number;
  steps: PriceStep[];
}

/**
 * A list price, always in the same order: base price (by class and size) → how it is delivered
 * → the branch's zone → rounded. Branch overrides and offers come after, elsewhere. A doorstep
 * price set for the size (`doorstepBase`) replaces the base price and the doorstep rule.
 */
export function listPrice(input: {
  base: number;
  mode: DeliveryMode;
  classKey: string;
  adjustments: readonly ModeAdjustment[];
  zonePercentBp: number;
  roundToPaise: number;
  doorstepBase?: number | null;
}): ListPrice {
  const own = input.mode === 'doorstep' && input.doorstepBase != null;
  const steps: PriceStep[] = [{ label: own ? 'Doorstep price' : 'Base price', amount: own ? input.doorstepBase! : input.base }];
  let price = own ? input.doorstepBase! : input.base;

  const adj = own ? null : modeAdjustmentFor(input.adjustments, input.mode, input.classKey);
  if (adj) {
    // A rule can be an extra ("15% more, at least ₹50") or a discount ("10% less"): the minimum
    // only applies to an extra.
    const raw = Math.round((input.base * adj.percentBp) / 10_000) + adj.fixedPaise;
    const extra = raw > 0 || adj.minExtraPaise > 0 ? Math.max(adj.minExtraPaise, raw) : raw;
    if (extra !== 0) {
      steps.push({ label: input.mode === 'doorstep' ? (extra < 0 ? 'Community discount' : 'Community extra') : 'Hub extra', amount: extra });
      price += extra;
    }
  }

  if (input.zonePercentBp !== 0) {
    const extra = Math.round((price * input.zonePercentBp) / 10_000);
    steps.push({ label: 'Zone', amount: extra });
    price += extra;
  }

  const rounded = clampPrice(roundPaise(price, input.roundToPaise));
  if (rounded !== price) steps.push({ label: 'Rounded', amount: rounded - price });
  return { price: rounded, steps };
}

/** The prices a branch may set for a service whose list price is `list`. */
export function overrideRange(list: number, policy: PricingPolicy): { min: number; max: number } {
  return {
    min: clampPrice(Math.ceil((list * (100 - policy.maxDecreasePct)) / 100)),
    max: clampPrice(Math.floor((list * (100 + policy.maxIncreasePct)) / 100)),
  };
}

export type OverrideCheck = 'ok' | 'not_allowed' | 'out_of_range';

export function checkOverride(list: number, price: number, policy: PricingPolicy): OverrideCheck {
  if (!policy.branchOverrides) return 'not_allowed';
  const { min, max } = overrideRange(list, policy);
  return price >= min && price <= max ? 'ok' : 'out_of_range';
}

/**
 * What a branch actually charges given its stored override. An override that fell outside the
 * range (the list price or the limits changed since) is pulled to the nearest edge; with
 * overrides switched off the list price applies. Stored overrides are kept either way, so
 * switching the policy back restores them.
 */
export function effectivePrice(list: number, override: number | null, policy: PricingPolicy): { price: number; overridden: boolean } {
  if (override == null || !policy.branchOverrides) return { price: list, overridden: false };
  const { min, max } = overrideRange(list, policy);
  return { price: Math.min(max, Math.max(min, override)), overridden: true };
}

// ─── Branch menu planning ───────────────────────────────────────────────────

/** What a branch's copy of a service carries besides name and places (checklist kept as stored JSON). */
export interface ServiceMenuDetails {
  teamAt: TeamPlaces;
  durationMin: number | null;
  kind: ServiceKind;
  popular: boolean;
  showInApp: boolean;
  checklist: string | null;
}
export const DEFAULT_SERVICE_DETAILS: ServiceMenuDetails = {
  teamAt: 'both',
  durationMin: null,
  kind: 'wash',
  popular: false,
  showInApp: true,
  checklist: null,
};

export interface CatalogServiceInput {
  id: string;
  name: string;
  description: string | null;
  modes: ServiceModes;
  details?: ServiceMenuDetails;
  classKeys: readonly string[];
  /** Sizes it's for, as `classKey|sizeKey`; left out = every size of its classes. */
  sizeKeys?: readonly string[];
  /** Catalog ids of the services a combo bundles; empty for a plain service. */
  includes: readonly string[];
  sortOrder: number;
  active: boolean;
}

export interface BranchVehicleInput {
  vehicleTypeId: string;
  /** Null when the vehicle type isn't linked to a body type: it gets no catalog prices. */
  classKey: string | null;
  sizeKey: string | null;
}

export interface BranchPlanInput {
  services: readonly CatalogServiceInput[];
  /** Base prices keyed by `basePriceKey(serviceId, classKey, sizeKey)`. */
  basePrices: ReadonlyMap<string, number>;
  /** Doorstep prices set for a size, same keys; they replace the doorstep rule. */
  doorstepPrices?: ReadonlyMap<string, number>;
  adjustments: readonly ModeAdjustment[];
  policy: PricingPolicy;
  zonePercentBp: number;
  /** Classes the branch washes for each way it delivers (from `branchCapabilities`). */
  classesByMode: ReadonlyMap<DeliveryMode, ReadonlySet<string>>;
  vehicles: readonly BranchVehicleInput[];
  /** Catalog services this branch switched off (ignored when the policy forbids hiding). */
  hidden: ReadonlySet<string>;
  /** Branch prices keyed by `branchPriceKey(serviceId, vehicleTypeId, mode)`. */
  overrides: ReadonlyMap<string, number>;
}

export interface PlannedService {
  catalogServiceId: string;
  name: string;
  description: string | null;
  appliesTo: ServiceAppliesTo;
  modes: ServiceModes;
  details: ServiceMenuDetails;
  sortOrder: number;
  includes: string[];
}

export interface PlannedPrice {
  catalogServiceId: string;
  vehicleTypeId: string;
  mode: DeliveryMode;
  price: number;
  listPrice: number;
  source: 'template' | 'override';
}

export interface BranchPlan {
  services: PlannedService[];
  prices: PlannedPrice[];
}

export const basePriceKey = (serviceId: string, classKey: string, sizeKey: string) => `${serviceId}|${classKey}|${sizeKey}`;
export const branchPriceKey = (serviceId: string, vehicleTypeId: string, mode: DeliveryMode) => `${serviceId}|${vehicleTypeId}|${mode}`;

export function appliesToForClasses(classKeys: readonly string[]): ServiceAppliesTo {
  const cats = new Set(classKeys.map((k) => categoryForClass(k)));
  if (cats.has('car') && cats.has('bike')) return 'both';
  return cats.has('bike') ? 'bike' : 'car';
}

/**
 * The menu a branch should show: every active catalog service it can deliver (a way it works ∩
 * where the service can be done, a class it washes ∩ the service's classes), priced for each of
 * its vehicle types that has a base price. A service with no price at all is left out, and a
 * combo only lists the bundled services the branch also offers.
 */
export function planBranchMenu(input: BranchPlanInput): BranchPlan {
  const prices: PlannedPrice[] = [];
  const offered = new Set<string>();

  const services = [...input.services]
    .filter((s) => s.active && !(input.policy.branchCanHideServices && input.hidden.has(s.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  for (const s of services) {
    const serviceClasses = new Set(s.classKeys);
    const serviceSizes = s.sizeKeys ? new Set(s.sizeKeys) : null;
    for (const v of input.vehicles) {
      if (!v.classKey || !v.sizeKey || !serviceClasses.has(v.classKey)) continue;
      if (serviceSizes && !serviceSizes.has(`${v.classKey}|${v.sizeKey}`)) continue;
      const key = basePriceKey(s.id, v.classKey, v.sizeKey);
      const base = input.basePrices.get(key);
      if (base == null) continue;
      // A home wash is charged the hub price (plus a visit charge on the bill), so a service the
      // team does at homes gets a hub price even where the shop itself doesn't do it.
      const atHomes =
        serviceModesInclude(s.modes, 'doorstep') &&
        (s.details?.teamAt ?? 'both') !== 'community' &&
        Boolean(input.classesByMode.get('doorstep')?.has(v.classKey));
      for (const mode of DELIVERY_MODES) {
        const served = serviceModesInclude(s.modes, mode) && Boolean(input.classesByMode.get(mode)?.has(v.classKey));
        if (!served && !(mode === 'hub' && atHomes)) continue;
        const list = listPrice({
          base,
          mode,
          classKey: v.classKey,
          adjustments: input.adjustments,
          zonePercentBp: input.zonePercentBp,
          roundToPaise: input.policy.roundToPaise,
          doorstepBase: input.doorstepPrices?.get(key),
        }).price;
        const stored = input.overrides.get(branchPriceKey(s.id, v.vehicleTypeId, mode)) ?? null;
        const eff = effectivePrice(list, stored, input.policy);
        prices.push({
          catalogServiceId: s.id,
          vehicleTypeId: v.vehicleTypeId,
          mode,
          price: eff.price,
          listPrice: list,
          source: eff.overridden ? 'override' : 'template',
        });
        offered.add(s.id);
      }
    }
  }

  return {
    services: services
      .filter((s) => offered.has(s.id))
      .map((s) => ({
        catalogServiceId: s.id,
        name: s.name,
        description: s.description,
        appliesTo: appliesToForClasses(s.classKeys),
        modes: s.modes,
        details: s.details ?? DEFAULT_SERVICE_DETAILS,
        sortOrder: s.sortOrder,
        includes: s.includes.filter((id) => offered.has(id)),
      })),
    prices,
  };
}

export interface BranchCapabilities {
  /** Ways the branch delivers, in `DELIVERY_MODES` order. */
  modes: DeliveryMode[];
  /** Every class the branch washes, any way. */
  classKeys: Set<string>;
  /** Classes washed per way: a hub may take cars while its doorstep team also takes tractors. */
  classesByMode: Map<DeliveryMode, Set<string>>;
}

/**
 * Ways a branch delivers and classes it washes, from its active service points. A branch with
 * no service points yet behaves like a plain hub that washes everything, so branches set up
 * before service points existed keep their whole menu.
 */
export function branchCapabilities(
  points: readonly { kind: ServicePointKind; active: boolean; classKeys: readonly string[] }[],
  allClassKeys: readonly string[],
): BranchCapabilities {
  const live = points.filter((p) => p.active);
  if (!live.length) {
    const all = new Set(allClassKeys);
    return { modes: ['hub'], classKeys: all, classesByMode: new Map([['hub', all]]) };
  }
  const classesByMode = new Map<DeliveryMode, Set<string>>();
  for (const p of live) {
    const set = classesByMode.get(p.kind) ?? new Set<string>();
    for (const k of p.classKeys) set.add(k);
    classesByMode.set(p.kind, set);
  }
  const modes = DELIVERY_MODES.filter((m) => classesByMode.has(m));
  const classKeys = new Set(live.flatMap((p) => p.classKeys));
  return { modes, classKeys, classesByMode };
}

/** The classes a service point washes when it's first created: cars and two-wheelers. */
export const DEFAULT_POINT_CLASSES: readonly VehicleClassKey[] = ['car', 'twoWheeler'];

export const SERVICE_POINT_NAME_MAX = 60;
export const CATALOG_SERVICE_NAME_MAX = 60;
export const CATALOG_SERVICE_DESCRIPTION_MAX = 160;
export const CATALOG_NAME_MAX = 40;
export const PRICE_ZONE_NAME_MAX = 40;
export const PRICE_BOOK_NAME_MAX = 40;
