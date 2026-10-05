import { canRateWash, LIVE_WASH_HOURS, type ProblemKind } from '@mana/domain';
import type { DbClient } from '../client';
import { rewardRepo } from './rewardRepo';

/** A listed branch where this phone is a customer. */
export interface CustomerLink {
  shopId: string;
  shopName: string;
  city: string | null;
  customerId: string;
  customerName: string | null;
}

/** Live and paid washes; voided jobs never reach the customer. */
const VISIBLE_JOB = { status: { not: 'void' } } as const;

const washSelect = {
  id: true,
  status: true,
  total: true,
  discount: true,
  paymentMethod: true,
  createdAt: true,
  completedAt: true,
  vehicle: { select: { id: true, registrationNumber: true, make: true, model: true, vehicleType: { select: { category: true } } } },
  jobServices: { select: { quantity: true, service: { select: { name: true } } } },
  _count: { select: { photos: { where: { deletedAt: null } } } },
} as const;

type WashRow = Awaited<ReturnType<typeof loadWashes>>[number];

function loadWashes(db: DbClient, customerId: string, before: Date | null, take: number) {
  return db.job.findMany({
    where: { customerId, ...VISIBLE_JOB, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: washSelect,
  });
}

const branchOf = (link: CustomerLink) => ({ id: link.shopId, name: link.shopName, city: link.city });

function washView(row: WashRow, link: CustomerLink) {
  return {
    id: row.id,
    status: row.status as 'waiting' | 'washing' | 'ready' | 'paid',
    total: row.total,
    discount: row.discount,
    paymentMethod: row.paymentMethod,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    vehicle: {
      id: row.vehicle.id,
      registrationNumber: row.vehicle.registrationNumber,
      make: row.vehicle.make,
      model: row.vehicle.model,
      /** Car or bike, so lists can show the right icon. */
      category: row.vehicle.vehicleType.category as 'car' | 'bike',
    },
    services: row.jobServices.map((l) => ({ name: l.service.name, quantity: l.quantity })),
    photoCount: row._count.photos,
    branch: branchOf(link),
  };
}

export type CustomerWashView = ReturnType<typeof washView>;

/**
 * Everything the MANA Car Wash app reads about a signed-in customer. Each query runs through the
 * branch's shop-scoped client *and* filters by that branch's customer id for this phone, so a
 * customer can only ever see their own vehicles, washes and photos.
 */
export const customerAppRepo = {
  /** Platform client: every listed branch with a customer on this number. */
  async links(platform: DbClient, phone: string): Promise<CustomerLink[]> {
    const shops = await platform.shop.findMany({
      where: { inCustomerApp: true },
      select: { id: true, name: true, city: true },
      orderBy: { createdAt: 'asc' },
    });
    if (shops.length === 0) return [];
    const customers = await platform.customer.findMany({
      where: { phone, shopId: { in: shops.map((s) => s.id) } },
      select: { id: true, shopId: true, name: true },
    });
    return shops.flatMap((s) => {
      const c = customers.find((x) => x.shopId === s.id);
      return c ? [{ shopId: s.id, shopName: s.name, city: s.city, customerId: c.id, customerName: c.name }] : [];
    });
  },

  /** One branch's vehicles for this customer, with stamp cards, offers and owed gifts. */
  async vehicles(db: DbClient, link: CustomerLink, now: Date) {
    const vehicles = await db.vehicle.findMany({
      where: { customerId: link.customerId, appHiddenAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        registrationNumber: true,
        make: true,
        model: true,
        vehicleType: { select: { name: true, category: true } },
      },
    });
    if (vehicles.length === 0) return [];
    const ids = vehicles.map((v) => v.id);
    const [cards, lastVisits, coupons, gifts] = await Promise.all([
      rewardRepo.cardsForVehicles(db, ids, now),
      db.job.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: ids }, customerId: link.customerId, status: 'paid' },
        _max: { createdAt: true },
        _count: { _all: true },
      }),
      db.coupon.findMany({
        where: { customerId: link.customerId, vehicleId: { in: ids }, status: 'active', expiresAt: { gt: now } },
        select: { vehicleId: true, code: true, percent: true, kind: true, expiresAt: true },
      }),
      rewardRepo.owedGifts(db, { customerId: link.customerId }),
    ]);
    const visitBy = new Map(lastVisits.map((v) => [v.vehicleId, v]));
    return vehicles.map((v) => ({
      id: v.id,
      registrationNumber: v.registrationNumber,
      make: v.make,
      model: v.model,
      type: { name: v.vehicleType.name, category: v.vehicleType.category as 'car' | 'bike' },
      branch: branchOf(link),
      lastWashAt: visitBy.get(v.id)?._max.createdAt?.toISOString() ?? null,
      washes: visitBy.get(v.id)?._count._all ?? 0,
      cards: (cards.get(v.id) ?? []).map((c) => ({
        serviceName: c.serviceName,
        every: c.every,
        stamps: c.stamps,
        free: c.free,
        expiresAt: c.expiresAt,
      })),
      offers: coupons
        .filter((c) => c.vehicleId === v.id)
        .map((c) => ({ code: c.code, percent: c.percent, kind: c.kind, expiresAt: c.expiresAt.toISOString() })),
      giftsOwed: gifts
        .filter((g) => g.vehicleId === v.id)
        .map((g) => ({ itemName: g.itemName, quantity: g.quantity, unit: g.unit })),
    }));
  },

  /** One branch's washes, newest first: `take` rows created before `before`. */
  async washes(db: DbClient, link: CustomerLink, before: Date | null, take: number) {
    return (await loadWashes(db, link.customerId, before, take)).map((r) => washView(r, link));
  },

  /** A wash with its photos, rating and reports, or null when it isn't this customer's (or was voided). */
  async wash(db: DbClient, link: CustomerLink, jobId: string, now: Date) {
    const row = await db.job.findFirst({
      where: { id: jobId, customerId: link.customerId, ...VISIBLE_JOB },
      select: {
        ...washSelect,
        subtotal: true,
        photos: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, kind: true, createdAt: true },
        },
        rating: { select: { stars: true, comment: true, updatedAt: true } },
        problems: {
          where: { customerId: link.customerId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, kind: true, status: true, resolution: true, createdAt: true },
        },
      },
    });
    if (!row) return null;
    return {
      ...washView(row, link),
      subtotal: row.subtotal,
      photos: row.photos.map((p) => ({
        id: p.id,
        kind: p.kind as 'before' | 'after',
        createdAt: p.createdAt.toISOString(),
      })),
      rating: row.rating
        ? { stars: row.rating.stars, comment: row.rating.comment, updatedAt: row.rating.updatedAt.toISOString() }
        : null,
      canRate: canRateWash({ status: row.status, paidAt: row.completedAt, now }),
      problems: row.problems.map((p) => ({
        id: p.id,
        kind: p.kind as ProblemKind,
        status: p.status as 'open' | 'resolved',
        resolution: p.resolution,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  },

  /** Washes on the board right now (queue, washing, ready), with how many vehicles are ahead. */
  async live(db: DbClient, link: CustomerLink, now: Date) {
    const since = new Date(now.getTime() - LIVE_WASH_HOURS * 60 * 60 * 1000);
    const jobs = await db.job.findMany({
      where: { customerId: link.customerId, status: { in: ['waiting', 'washing', 'ready'] }, createdAt: { gte: since } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
        jobServices: { select: { quantity: true, service: { select: { name: true } } } },
      },
    });
    return Promise.all(
      jobs.map(async (j) => ({
        id: j.id,
        status: j.status as 'waiting' | 'washing' | 'ready',
        total: j.total,
        createdAt: j.createdAt.toISOString(),
        vehicle: j.vehicle,
        services: j.jobServices.map((l) => ({ name: l.service.name, quantity: l.quantity })),
        // Only a count leaves the branch: never whose vehicles they are.
        ahead:
          j.status === 'waiting'
            ? await db.job.count({
                where: { status: { in: ['waiting', 'washing'] }, createdAt: { gte: since, lt: j.createdAt } },
              })
            : 0,
        branch: branchOf(link),
      })),
    );
  },

  /** Friends this customer sent here, and whether they can refer yet (one paid wash first). */
  async referrals(db: DbClient, link: CustomerLink) {
    const [paid, rows] = await Promise.all([
      db.job.count({ where: { customerId: link.customerId, status: 'paid' } }),
      db.referral.findMany({
        where: { referrerCustomerId: link.customerId, status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, status: true, percent: true, createdAt: true, referred: { select: { name: true } } },
      }),
    ]);
    return {
      paidWashes: paid,
      referrals: rows.map((r) => ({
        id: r.id,
        // First name only: the friend's number and full name stay with the car wash.
        friend: r.referred.name?.trim().split(/\s+/)[0] ?? null,
        status: r.status === 'pending' ? ('pending' as const) : ('rewarded' as const),
        createdAt: r.createdAt.toISOString(),
        branch: branchOf(link),
      })),
    };
  },

  /** Platform client: every listed branch with its contact details, hours and price list. */
  async branches(platform: DbClient) {
    const shops = await platform.shop.findMany({
      where: { inCustomerApp: true },
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
        latitude: true,
        longitude: true,
      },
    });
    if (shops.length === 0) return [];
    const shopIds = shops.map((s) => s.id);
    const [types, services, reviewLinks] = await Promise.all([
      platform.vehicleType.findMany({
        where: { shopId: { in: shopIds }, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, shopId: true, name: true, category: true },
      }),
      platform.service.findMany({
        where: { shopId: { in: shopIds }, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          shopId: true,
          name: true,
          description: true,
          prices: { where: { price: { gt: 0 } }, select: { vehicleTypeId: true, price: true } },
          comboItems: { select: { service: { select: { name: true, active: true } } } },
        },
      }),
      platform.appSetting.findMany({
        where: { shopId: { in: shopIds }, key: 'google_review_url' },
        select: { shopId: true, value: true },
      }),
    ]);
    return shops.map((s) => {
      const shopTypes = types.filter((t) => t.shopId === s.id);
      const typeIds = new Set(shopTypes.map((t) => t.id));
      return {
        id: s.id,
        name: s.name,
        city: s.city,
        address: s.address,
        phone: s.contactPhone,
        location: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
        hours: { opensAt: s.opensAt, closesAt: s.closesAt, weeklyOff: s.weeklyOff },
        reviewUrl: reviewLinks.find((r) => r.shopId === s.id)?.value ?? null,
        vehicleTypes: shopTypes.map((t) => ({ id: t.id, name: t.name, category: t.category as 'car' | 'bike' })),
        services: services
          .filter((sv) => sv.shopId === s.id)
          .map((sv) => ({
            id: sv.id,
            name: sv.name,
            description: sv.description,
            includes: sv.comboItems.filter((c) => c.service.active).map((c) => c.service.name),
            prices: sv.prices.filter((p) => typeIds.has(p.vehicleTypeId)),
          }))
          .filter((sv) => sv.prices.length > 0),
      };
    });
  },

  /** The stored file of a photo on one of this customer's (non-voided) washes. */
  async photo(db: DbClient, link: CustomerLink, photoId: string) {
    return db.jobPhoto.findFirst({
      where: { id: photoId, deletedAt: null, job: { customerId: link.customerId, ...VISIBLE_JOB } },
      select: { r2Key: true, contentType: true },
    });
  },
};
