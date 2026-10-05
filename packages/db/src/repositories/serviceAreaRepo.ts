import { areaNameKey, type ServiceBranch } from '@mana/domain';
import type { DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';

const areaSelect = { id: true, name: true, pincode: true, active: true } as const;

/** Where a shop washes: its hub and radius (on the shop row) and its named areas. */
export const serviceAreaRepo = {
  /** Shop-scoped client. The shop row is platform data, so it's addressed by id explicitly. */
  async get(db: DbClient) {
    const shopId = db.$shopId();
    const [shop, areas] = await Promise.all([
      db.shop.findUnique({
        where: { id: shopId },
        select: {
          inCustomerApp: true,
          latitude: true,
          longitude: true,
          serviceRadiusKm: true,
          address: true,
          contactPhone: true,
          opensAt: true,
          closesAt: true,
          weeklyOff: true,
        },
      }),
      db.serviceArea.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: areaSelect }),
    ]);
    return {
      inCustomerApp: shop?.inCustomerApp ?? false,
      hub: shop?.latitude != null && shop.longitude != null ? { latitude: shop.latitude, longitude: shop.longitude } : null,
      radiusKm: shop?.serviceRadiusKm ?? null,
      contact: {
        address: shop?.address ?? null,
        phone: shop?.contactPhone ?? null,
        opensAt: shop?.opensAt ?? null,
        closesAt: shop?.closesAt ?? null,
        weeklyOff: shop?.weeklyOff ?? null,
      },
      areas,
    };
  },

  /** What customers see on the branch page: address, phone and opening hours. */
  async setContact(
    db: DbClient,
    data: { address: string | null; phone: string | null; opensAt: string | null; closesAt: string | null; weeklyOff: number | null },
  ) {
    await db.shop.update({
      where: { id: db.$shopId() },
      data: {
        address: data.address,
        contactPhone: data.phone,
        opensAt: data.opensAt,
        closesAt: data.closesAt,
        weeklyOff: data.weeklyOff,
      },
    });
  },

  /** Shop-scoped client: whether Sprixia has listed this branch in the MANA Car Wash app. */
  async isListed(db: DbClient): Promise<boolean> {
    const shop = await db.shop.findUnique({ where: { id: db.$shopId() }, select: { inCustomerApp: true } });
    return shop?.inCustomerApp ?? false;
  },

  async setHub(db: DbClient, data: { latitude: number | null; longitude: number | null; radiusKm: number | null }) {
    await db.shop.update({
      where: { id: db.$shopId() },
      data: { latitude: data.latitude, longitude: data.longitude, serviceRadiusKm: data.radiusKm },
    });
  },

  /** Null when a live area already has this name. */
  async createArea(db: DbClient, data: { name: string; pincode: string | null }) {
    try {
      return await db.serviceArea.create({
        data: { name: data.name, nameKey: areaNameKey(data.name), pincode: data.pincode },
        select: areaSelect,
      });
    } catch (e) {
      if (isUniqueClash(e)) return null;
      throw e;
    }
  },

  /** 'not_found' | 'name_taken' | the updated area. */
  async updateArea(db: DbClient, id: string, data: { name?: string; pincode?: string | null; active?: boolean }) {
    const existing = await db.serviceArea.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return 'not_found' as const;
    try {
      return await db.serviceArea.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name, nameKey: areaNameKey(data.name) } : {}),
          ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
        select: areaSelect,
      });
    } catch (e) {
      if (isUniqueClash(e)) return 'name_taken' as const;
      throw e;
    }
  },

  // ---------- Across branches (platform client) ----------

  /** Every branch listed in the customer app, with what `branchFor` needs. */
  async listBranches(platform: DbClient): Promise<(ServiceBranch & { name: string; city: string | null })[]> {
    const shops = await platform.shop.findMany({
      where: { inCustomerApp: true },
      select: { id: true, name: true, city: true, latitude: true, longitude: true, serviceRadiusKm: true },
    });
    if (shops.length === 0) return [];
    const areas = await platform.serviceArea.findMany({
      where: { shopId: { in: shops.map((s) => s.id) }, active: true },
      select: { id: true, shopId: true },
    });
    return shops.map((s) => ({
      shopId: s.id,
      name: s.name,
      city: s.city,
      hub: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
      radiusKm: s.serviceRadiusKm,
      areaIds: areas.filter((a) => a.shopId === s.id).map((a) => a.id),
    }));
  },

  /** The area picker in the app: every live area of every listed branch. */
  async listPublicAreas(platform: DbClient) {
    const shops = await platform.shop.findMany({
      where: { inCustomerApp: true },
      select: { id: true, name: true, city: true },
    });
    if (shops.length === 0) return [];
    const byId = new Map(shops.map((s) => [s.id, s]));
    const areas = await platform.serviceArea.findMany({
      where: { shopId: { in: [...byId.keys()] }, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, pincode: true, shopId: true },
    });
    return areas.map((a) => ({
      id: a.id,
      name: a.name,
      pincode: a.pincode,
      branch: { name: byId.get(a.shopId)!.name, city: byId.get(a.shopId)!.city },
    }));
  },

  /**
   * "Car wash from ₹X": the lowest active price per vehicle category across listed branches,
   * from services offered for that category on active vehicle sizes.
   */
  async lowestPrices(platform: DbClient): Promise<{ car: number | null; bike: number | null }> {
    const shops = await platform.shop.findMany({ where: { inCustomerApp: true }, select: { id: true } });
    if (shops.length === 0) return { car: null, bike: null };
    const shopIds = shops.map((s) => s.id);
    const lowest = async (category: 'car' | 'bike') => {
      const row = await platform.servicePrice.findFirst({
        where: {
          shopId: { in: shopIds },
          price: { gt: 0 },
          vehicleType: { active: true, category },
          service: { active: true, appliesTo: { in: [category, 'both'] } },
        },
        orderBy: { price: 'asc' },
        select: { price: true },
      });
      return row?.price ?? null;
    };
    const [car, bike] = await Promise.all([lowest('car'), lowest('bike')]);
    return { car, bike };
  },
};
