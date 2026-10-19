import { useCallback, useEffect, useState } from 'react';
import { parseVehicleCategory, type DoorstepVisitRules, type VehicleCategory } from '@mana/domain';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import type { Lane } from '../components/board/lanes';
import { SERVICE_GROUP_ORDER, groupForService } from './services';
import type { ServiceGroup } from '../components/ServicePickRow';

/**
 * The branch's menu: what it sells and for how much, at its hub, at communities and at customers'
 * homes. Built from the same catalog New Wash sells from, so the menu and the bill always agree:
 *
 *   Hub        the shop's prices, without services or vehicles done only at homes.
 *   Community  the team's price (communities and homes share it), for what the team does at
 *              communities.
 *   Doorstep   head office's services at the hub price (a visit charge is added once per visit);
 *              the branch's own services at their doorstep price.
 *
 * Wash plans come first: the hub has the plans sold at the counter, a community the plans sold
 * when joining (priced as the business's community rules say). Plans aren't sold at homes.
 *
 * Only vehicle types this branch washes in that place appear, so the menu is the branch's own.
 */

export interface MenuService {
  id: string;
  name: string;
  description: string | null;
  includes: string[];
  teamAt?: string;
  modes?: string;
  catalogServiceId?: string | null;
  durationMin?: number | null;
  popular?: boolean;
  sortOrder: number;
}

export interface MenuVehicleType {
  id: string;
  name: string;
  category: VehicleCategory;
  sortOrder: number;
  bodyKey: string | null;
}

interface PriceRow {
  serviceId: string;
  vehicleTypeId: string;
  price: number;
  mode?: string;
}

export type MenuLanes = Record<Lane, boolean>;

/** A wash plan as the server prices it, for each vehicle type it serves. */
export interface MenuPlanRaw {
  id: string;
  name: string;
  washes: number;
  months: number;
  perWeek: number;
  popular: boolean;
  serviceName: string;
  upgrade: { every: number; name: string } | null;
  prices: { vehicleTypeId: string; perWash: number; total: number; listTotal: number }[];
}

export interface MenuCatalog {
  services: MenuService[];
  vehicleTypes: MenuVehicleType[];
  prices: PriceRow[];
  lanes: MenuLanes;
  visit: DoorstepVisitRules | null;
  homeOnlyTypes: string[];
  /** Missing from menus saved by an older version of the app. */
  plans?: { hub: MenuPlanRaw[]; community: MenuPlanRaw[] };
}

export interface MenuItem {
  service: MenuService;
  /** Price in paise for each vehicle type it's sold for here. */
  prices: Map<string, number>;
  /** Names of the services a combo bundles. */
  includedNames: string[];
  /** A wash plan: what it saves against paying for its washes one by one, per vehicle type. */
  saving?: Map<string, number>;
}

/** "Plans", then New Wash's service groups. */
export type MenuGroup = 'Plans' | ServiceGroup;

export interface MenuSection {
  group: MenuGroup;
  items: MenuItem[];
}

export interface LaneMenu {
  sections: MenuSection[];
  /** The vehicle types with at least one price on this menu, in the branch's order. */
  vehicleTypes: MenuVehicleType[];
}

const HUB_ONLY: MenuLanes = { hub: true, community: false, doorstep: false };

/** Whether a service is sold in this place at all. */
function soldIn(s: MenuService, lane: Lane): boolean {
  const fromHq = Boolean(s.catalogServiceId);
  if (lane === 'hub') return !(fromHq && s.modes === 'doorstep');
  if (lane === 'doorstep') return !(s.teamAt === 'community' || s.modes === 'hub');
  return s.modes !== 'hub' && s.teamAt !== 'doorstep';
}

/** Which stored price applies in this place. */
function priceMode(s: MenuService, lane: Lane): 'hub' | 'doorstep' {
  if (lane === 'hub') return 'hub';
  if (lane === 'doorstep') return s.catalogServiceId ? 'hub' : 'doorstep';
  return 'doorstep';
}

/**
 * The menu's order inside a group: Express, then Basic, then Shine (or Premium) — the ladder a
 * customer climbs — then everything else in head office's order. Popular gets a badge, not a jump.
 */
function tierRank(name: string): number {
  if (/express/i.test(name)) return 0;
  if (/basic/i.test(name)) return 1;
  if (/shine|premium/i.test(name)) return 2;
  return 3;
}

function byTier(a: MenuItem, b: MenuItem): number {
  const bike = (i: MenuItem) => Number(/bike/i.test(i.service.name));
  return bike(a) - bike(b) || tierRank(a.service.name) - tierRank(b.service.name) || a.service.sortOrder - b.service.sortOrder;
}

/** One place's menu, grouped like New Wash (combos, washes, interior, protection, add-ons). */
export function laneMenu(catalog: MenuCatalog, lane: Lane): LaneMenu {
  const homeOnly = new Set(catalog.homeOnlyTypes);
  const byId = new Map(catalog.services.map((s) => [s.id, s]));
  const items = new Map<string, MenuItem>();
  for (const p of catalog.prices) {
    const s = byId.get(p.serviceId);
    if (!s || !soldIn(s, lane)) continue;
    if ((p.mode ?? 'hub') !== priceMode(s, lane)) continue;
    if (lane === 'hub' && homeOnly.has(p.vehicleTypeId)) continue;
    let item = items.get(s.id);
    if (!item) {
      item = {
        service: s,
        prices: new Map(),
        includedNames: s.includes.map((id) => byId.get(id)?.name).filter((n): n is string => Boolean(n)),
      };
      items.set(s.id, item);
    }
    item.prices.set(p.vehicleTypeId, p.price);
  }
  const plans = lane === 'doorstep' ? [] : planItems(catalog.plans?.[lane] ?? [], new Set(catalog.vehicleTypes.map((t) => t.id)));
  const used = new Set([...items.values(), ...plans].flatMap((i) => [...i.prices.keys()]));
  const vehicleTypes = catalog.vehicleTypes
    .filter((vt) => used.has(vt.id))
    .sort((a, b) => (a.category === b.category ? a.sortOrder - b.sortOrder : a.category === 'car' ? -1 : 1));
  const grouped = new Map<ServiceGroup, MenuItem[]>();
  for (const item of items.values()) {
    const g = groupForService(item.service);
    grouped.set(g, [...(grouped.get(g) ?? []), item]);
  }
  const sections: MenuSection[] = SERVICE_GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => ({
    group,
    items: grouped
      .get(group)!
      .sort(byTier),
  }));
  if (plans.length) sections.unshift({ group: 'Plans', items: plans });
  return { sections, vehicleTypes };
}

/** "8 washes · 2 months · 1 a week · Basic Wash · every 4th is Premium Wash". */
function planLine(p: MenuPlanRaw): string {
  const bits = [
    `${p.washes} washes`,
    `${p.months} ${p.months === 1 ? 'month' : 'months'}`,
    p.perWeek > 0 ? `${p.perWeek} a week` : null,
    p.serviceName,
    p.upgrade ? `every ${ordinal(p.upgrade.every)} wash is ${p.upgrade.name}` : null,
  ];
  return bits.filter(Boolean).join(' · ');
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${tail}`;
}

/** Plans as menu lines: the plan price per vehicle type, and what it saves. */
function planItems(plans: readonly MenuPlanRaw[], typeIds: ReadonlySet<string>): MenuItem[] {
  return plans
    .map((p) => {
      const prices = new Map<string, number>();
      const saving = new Map<string, number>();
      for (const pr of p.prices) {
        if (!typeIds.has(pr.vehicleTypeId)) continue;
        prices.set(pr.vehicleTypeId, pr.total);
        if (pr.listTotal > pr.total) saving.set(pr.vehicleTypeId, pr.listTotal - pr.total);
      }
      return {
        service: {
          id: `plan-${p.id}`,
          name: p.name,
          description: planLine(p),
          includes: [],
          popular: p.popular,
          sortOrder: p.months * 1000 + p.washes,
        },
        prices,
        includedNames: [],
        saving,
      };
    })
    .filter((item) => item.prices.size > 0)
    // Cars' plans, then bikes'; Express, Basic, Shine; within a tier 1, 3, then 12 months.
    .sort(byTier);
}

/** Narrow a menu to one vehicle type (services it isn't sold for drop out). */
export function forVehicle(menu: LaneMenu, vehicleTypeId: string | null): LaneMenu {
  if (!vehicleTypeId) return menu;
  const sections = menu.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.prices.has(vehicleTypeId)) }))
    .filter((s) => s.items.length > 0);
  return { sections, vehicleTypes: menu.vehicleTypes.filter((vt) => vt.id === vehicleTypeId) };
}

/** Narrow a menu to cars or bikes. */
export function forCategory(menu: LaneMenu, category: VehicleCategory | null): LaneMenu {
  if (!category) return menu;
  const ids = new Set(menu.vehicleTypes.filter((vt) => vt.category === category).map((vt) => vt.id));
  const sections = menu.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => [...i.prices.keys()].some((id) => ids.has(id))) }))
    .filter((s) => s.items.length > 0);
  return { sections, vehicleTypes: menu.vehicleTypes.filter((vt) => ids.has(vt.id)) };
}

/** The lowest price of an item among the given vehicle types, for "from ₹399". */
export function lowestPrice(item: MenuItem, typeIds?: readonly string[]): number | null {
  let low: number | null = null;
  for (const [id, price] of item.prices) {
    if (typeIds && !typeIds.includes(id)) continue;
    if (low == null || price < low) low = price;
  }
  return low;
}

/** "₹49 a visit, first 3 km free, then ₹10 a km (up to 15 km)". */
export function visitChargeLine(rules: DoorstepVisitRules, money: (paise: number) => string): string {
  const bits = [`${money(rules.visitFeePaise)} a visit`];
  if (rules.perKmPaise > 0) bits.push(`first ${rules.freeKm} km free, then ${money(rules.perKmPaise)} a km`);
  return `${bits.join(', ')} (up to ${rules.maxKm} km)`;
}

interface RawService {
  id: string;
  name: string;
  description?: string | null;
  includes?: string[] | null;
  teamAt?: string | null;
  modes?: string | null;
  catalogServiceId?: string | null;
  durationMin?: number | null;
  popular?: boolean | null;
  sortOrder?: number;
}

function fromServer(
  services: RawService[],
  types: { id: string; name: string; category: string; sortOrder: number; bodyKey?: string | null }[],
  prices: PriceRow[],
  network: {
    modes: string[];
    homeWash: boolean;
    lanes?: MenuLanes;
    visit?: DoorstepVisitRules | null;
    homeOnlyTypes?: string[];
  } | null,
): MenuCatalog {
  return {
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      includes: s.includes ?? [],
      teamAt: s.teamAt ?? undefined,
      modes: s.modes ?? undefined,
      catalogServiceId: s.catalogServiceId ?? null,
      durationMin: typeof s.durationMin === 'number' && s.durationMin > 0 ? s.durationMin : null,
      popular: Boolean(s.popular),
      sortOrder: s.sortOrder ?? 0,
    })),
    vehicleTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      category: parseVehicleCategory(t.category),
      sortOrder: t.sortOrder,
      bodyKey: t.bodyKey ?? null,
    })),
    prices: prices.map(({ serviceId, vehicleTypeId, price, mode }) => ({ serviceId, vehicleTypeId, price, mode })),
    lanes:
      network?.lanes ??
      (network
        ? { hub: network.modes.includes('hub'), community: false, doorstep: network.homeWash && network.modes.includes('doorstep') }
        : HUB_ONLY),
    visit: network?.visit ?? null,
    homeOnlyTypes: network?.homeOnlyTypes ?? [],
  };
}

/**
 * The branch's catalog for the menu: the copy saved on this phone at once (it works offline),
 * then the server's.
 */
/** The last menu this app session loaded, so reopening Menu shows it at once. */
let memory: MenuCatalog | null = null;

async function loadPlans(): Promise<{ hub: MenuPlanRaw[]; community: MenuPlanRaw[] }> {
  const [hub, community] = await Promise.all([
    api['shop-plans'].menu
      .$get()
      .then(async (r) => (r.ok ? ((await r.json()).plans as unknown as MenuPlanRaw[]) : null))
      .catch(() => null),
    api.places.menu
      .$get({ query: {} })
      .then(async (r) => (r.ok ? ((await r.json()).menu.plans as unknown as MenuPlanRaw[]) : null))
      .catch(() => null),
  ]);
  return { hub: hub ?? memory?.plans?.hub ?? [], community: community ?? memory?.plans?.community ?? [] };
}

/**
 * The branch's catalog for the menu: the copy in memory (or saved on this phone) at once, then the
 * server's — services first, plans as soon as they arrive, so neither waits for the other.
 */
export function useBranchMenu() {
  const [catalog, setCatalog] = useState<MenuCatalog | null>(memory);
  const [loading, setLoading] = useState(memory == null);
  const [error, setError] = useState<string | null>(null);

  const keep = useCallback((next: MenuCatalog) => {
    memory = next;
    setCatalog(next);
  }, []);

  const load = useCallback(async () => {
    const plans = loadPlans();
    try {
      const [servicesRes, typesRes, pricesRes, networkRes] = await Promise.all([
        api.services.$get({ query: {} }),
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.prices.$get({ query: {} }),
        api.services.network.$get(),
      ]);
      if (!servicesRes.ok || !typesRes.ok || !pricesRes.ok) throw new Error('Couldn’t load the menu.');
      const [services, types, prices, network] = await Promise.all([
        servicesRes.json(),
        typesRes.json(),
        pricesRes.json(),
        networkRes.ok ? networkRes.json() : null,
      ]);
      const fresh = fromServer(
        (Array.isArray(services) ? services : []) as unknown as RawService[],
        Array.isArray(types) ? (types as unknown as Parameters<typeof fromServer>[1]) : [],
        (Array.isArray(prices) ? prices : []) as unknown as PriceRow[],
        network as unknown as Parameters<typeof fromServer>[3],
      );
      fresh.plans = memory?.plans;
      keep(fresh);
      setError(null);
      setLoading(false);
      const withPlans = { ...fresh, plans: await plans };
      keep(withPlans);
      void writeCache(CacheKeys.menu, withPlans);
    } catch (e) {
      setError(
        e instanceof NetworkError ? 'Offline — showing the menu saved on this phone.' : e instanceof Error ? e.message : 'Couldn’t load the menu.',
      );
    } finally {
      setLoading(false);
    }
  }, [keep]);

  useEffect(() => {
    let alive = true;
    if (!memory) {
      void readCache<MenuCatalog>(CacheKeys.menu).then((saved) => {
        if (alive && saved && !memory) {
          memory = saved;
          setCatalog(saved);
          setLoading(false);
        }
      });
    }
    void load();
    return () => {
      alive = false;
    };
  }, [load]);

  return { catalog, loading, error, reload: load };
}
