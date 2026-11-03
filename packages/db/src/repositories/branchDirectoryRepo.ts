import {
  DELIVERY_MODES,
  parseChecklist,
  parseOffDays,
  parseServiceKind,
  parseServiceModes,
  BRANCH_SERVICES_SELECT,
  branchServicesOf,
} from '@mana/domain';
import type { DbClient } from '../client';
import { awayPricingRepo } from './awayPricingRepo';

/**
 * What the WhatsApp assistant tells customers about a business's branches: each active branch
 * with its contact details, hours, review link, the ways it washes, and its price list.
 */
export const branchDirectoryRepo = {
  /** Platform client: every active branch of the business (any business when its id is null). */
  async branches(platform: DbClient, business: { id: string | null }) {
    const shops = await platform.shop.findMany({
      where: { kind: 'branch', status: 'active', ...(business.id ? { businessId: business.id } : {}) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        contactPhone: true,
        opensAt: true,
        closesAt: true,
        weeklyOff: true,
        weeklyOffDays: true,
        latitude: true,
        longitude: true,
        businessId: true,
        ...BRANCH_SERVICES_SELECT,
      },
    });
    if (shops.length === 0) return [];
    const shopIds = shops.map((s) => s.id);
    const businessIds = [...new Set(shops.map((s) => s.businessId).filter((id): id is string => !!id))];
    const [types, services, reviewLinks, points, away] = await Promise.all([
      platform.vehicleType.findMany({
        where: { shopId: { in: shopIds }, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, shopId: true, name: true, category: true, bodyTypeId: true },
      }),
      // Services marked shop-only for staff aren't offered on WhatsApp.
      platform.service.findMany({
        where: { shopId: { in: shopIds }, active: true, showInApp: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          shopId: true,
          name: true,
          description: true,
          modes: true,
          teamAt: true,
          durationMin: true,
          kind: true,
          popular: true,
          checklist: true,
          prices: { where: { price: { gt: 0 } }, select: { vehicleTypeId: true, price: true, mode: true } },
          comboItems: { select: { service: { select: { name: true, active: true } } } },
        },
      }),
      platform.appSetting.findMany({
        where: { shopId: { in: shopIds }, key: 'google_review_url' },
        select: { shopId: true, value: true },
      }),
      platform.servicePoint.findMany({
        where: { shopId: { in: shopIds }, active: true },
        select: { shopId: true, kind: true, classes: { select: { classId: true } } },
      }),
      awayPricingRepo.many(platform, businessIds),
    ]);
    const bodyIds = [...new Set(types.map((t) => t.bodyTypeId).filter((id): id is string => !!id))];
    const bodies = bodyIds.length
      ? await platform.bodyType.findMany({ where: { id: { in: bodyIds } }, select: { id: true, key: true, classId: true } })
      : [];
    const bodyKey = new Map(bodies.map((b) => [b.id, b.key]));
    const bodyClass = new Map(bodies.map((b) => [b.id, b.classId]));
    return shops.map((s) => {
      const shopTypes = types.filter((t) => t.shopId === s.id);
      const typeIds = new Set(shopTypes.map((t) => t.id));
      const shopPoints = points.filter((p) => p.shopId === s.id);
      const kinds = new Set(shopPoints.map((p) => p.kind));
      // Classes the hub takes; a vehicle only the doorstep team washes isn't on the shop's list.
      const hubPoints = shopPoints.filter((p) => p.kind !== 'doorstep');
      const atHub = new Set(hubPoints.flatMap((p) => p.classes.map((c) => c.classId)));
      const shopWashes = (vehicleTypeId: string) => {
        if (!hubPoints.length || !kinds.has('doorstep')) return true;
        const bodyTypeId = shopTypes.find((t) => t.id === vehicleTypeId)?.bodyTypeId;
        const classId = bodyTypeId ? bodyClass.get(bodyTypeId) : undefined;
        return classId == null || atHub.has(classId);
      };
      // A team that only goes to communities isn't a way to book a wash at home.
      if (!branchServicesOf(s).live.doorstep) kinds.delete('doorstep');
      // No hub or home washing: a plain hub, as before the service network.
      const modes = DELIVERY_MODES.filter((m) => (kinds.size ? kinds.has(m) : m === 'hub'));
      return {
        id: s.id,
        name: s.name,
        city: s.city,
        address: s.address,
        phone: s.contactPhone,
        location: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
        hours: {
          opensAt: s.opensAt,
          closesAt: s.closesAt,
          weeklyOff: s.weeklyOff,
          weeklyOffDays: s.weeklyOffDays ? parseOffDays(s.weeklyOffDays) : s.weeklyOff != null ? [s.weeklyOff] : [],
        },
        reviewUrl: reviewLinks.find((r) => r.shopId === s.id)?.value ?? null,
        /** What a visit to a home costs on top of the price (once per visit, whatever the cars). */
        visit: modes.includes('doorstep') ? ((s.businessId && away.get(s.businessId)?.doorstep) || null) : null,
        /** Ways this branch washes: at its hub, at the customer's door, or both. */
        modes,
        vehicleTypes: shopTypes.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category as 'car' | 'bike',
          /** The catalog body type (e.g. "suvLarge"), for its picture; null for a hand-made type. */
          bodyKey: (t.bodyTypeId && bodyKey.get(t.bodyTypeId)) || null,
        })),
        services: services
          .filter((sv) => sv.shopId === s.id)
          .map((sv) => {
            // A home wash is the hub price plus the branch's visit charge; a service done only at
            // communities isn't offered at homes, and one done only at homes isn't sold at the shop.
            const svModes = parseServiceModes(sv.modes);
            const atShop = modes.includes('hub') && svModes !== 'doorstep';
            const atHomes = modes.includes('doorstep') && svModes !== 'hub' && sv.teamAt !== 'community';
            const hubRows = sv.prices
              .filter((p) => p.mode === 'hub' && typeIds.has(p.vehicleTypeId))
              .map((p) => ({ vehicleTypeId: p.vehicleTypeId, price: p.price }));
            return {
              id: sv.id,
              name: sv.name,
              description: sv.description,
              includes: sv.comboItems.filter((c) => c.service.active).map((c) => c.service.name),
              modes: svModes,
              durationMin: sv.durationMin,
              kind: parseServiceKind(sv.kind),
              popular: sv.popular,
              /** What's included, one short line each. */
              checklist: parseChecklist(sv.checklist),
              /** Prices at the hub. */
              prices: atShop ? hubRows.filter((p) => shopWashes(p.vehicleTypeId)) : [],
              /** Prices at the customer's door: the same, plus the visit charge once per visit. */
              doorstepPrices: atHomes ? hubRows : [],
            };
          })
          .filter((sv) => sv.prices.length > 0 || sv.doorstepPrices.length > 0),
      };
    });
  },
};
