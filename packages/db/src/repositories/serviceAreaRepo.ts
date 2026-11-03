import { formatOffDays, offDaysOf, parseOffDays } from '@mana/domain';
import type { DbClient } from '../client';

/** Where a shop washes (its hub and radius) and its contact details and hours, on the shop row. */
export const serviceAreaRepo = {
  /** Shop-scoped client. The shop row is platform data, so it's addressed by id explicitly. */
  async get(db: DbClient) {
    const shopId = db.$shopId();
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      select: {
        latitude: true,
        longitude: true,
        serviceRadiusKm: true,
        address: true,
        contactPhone: true,
        opensAt: true,
        closesAt: true,
        weeklyOff: true,
        weeklyOffDays: true,
      },
    });
    const offDays = shop ? offDaysOf({ weeklyOff: shop.weeklyOff, weeklyOffDays: shop.weeklyOffDays ? parseOffDays(shop.weeklyOffDays) : undefined }) : [];
    return {
      hub: shop?.latitude != null && shop.longitude != null ? { latitude: shop.latitude, longitude: shop.longitude } : null,
      radiusKm: shop?.serviceRadiusKm ?? null,
      contact: {
        address: shop?.address ?? null,
        phone: shop?.contactPhone ?? null,
        opensAt: shop?.opensAt ?? null,
        closesAt: shop?.closesAt ?? null,
        weeklyOff: offDays[0] ?? null,
        weeklyOffDays: offDays,
      },
    };
  },

  /** What customers see on WhatsApp and bills: address, phone and opening hours. */
  async setContact(
    db: DbClient,
    data: { address: string | null; phone: string | null; opensAt: string | null; closesAt: string | null; weeklyOffDays: number[] },
  ) {
    const days = offDaysOf({ weeklyOff: null, weeklyOffDays: data.weeklyOffDays });
    await db.shop.update({
      where: { id: db.$shopId() },
      data: {
        address: data.address,
        contactPhone: data.phone,
        opensAt: data.opensAt,
        closesAt: data.closesAt,
        // The first closed day too, for apps that only know one.
        weeklyOff: days[0] ?? null,
        weeklyOffDays: formatOffDays(days),
      },
    });
  },

  /**
   * Where the branch is and how far it serves customers: one distance for the branch, so its hub
   * and its team (which starts from the branch) go as far.
   */
  async setHub(db: DbClient, data: { latitude: number | null; longitude: number | null; radiusKm: number | null }) {
    await db.shop.update({
      where: { id: db.$shopId() },
      data: { latitude: data.latitude, longitude: data.longitude, serviceRadiusKm: data.radiusKm },
    });
    if (data.radiusKm != null) {
      await db.servicePoint.updateMany({ where: { latitude: { not: null } }, data: { radiusKm: data.radiusKm } });
    }
  },
};
