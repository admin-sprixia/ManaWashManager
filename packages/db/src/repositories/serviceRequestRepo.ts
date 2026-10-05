import {
  OPEN_REQUEST_STATUSES,
  type PlaceKind,
  type PreferredTime,
  type ServiceRequestStatus,
} from '@mana/domain';
import type { DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';

const OPEN = { in: [...OPEN_REQUEST_STATUSES] };

const requestSelect = {
  id: true,
  shopId: true,
  phone: true,
  name: true,
  latitude: true,
  longitude: true,
  address: true,
  placeKind: true,
  placeName: true,
  homeText: true,
  cars: true,
  bikes: true,
  preferredTime: true,
  notes: true,
  status: true,
  reason: true,
  customerId: true,
  createdAt: true,
  handledAt: true,
  area: { select: { id: true, name: true } },
  handledBy: { select: { id: true, name: true } },
} as const;

export interface NewServiceRequest {
  phone: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  areaId: string | null;
  address: string;
  placeKind: PlaceKind;
  placeName: string | null;
  homeText: string | null;
  cars: number;
  bikes: number;
  preferredTime: PreferredTime | null;
  notes: string | null;
  status: Extract<ServiceRequestStatus, 'pending' | 'out_of_area'>;
}

export const serviceRequestRepo = {
  /**
   * Shop-scoped client of the branch it's for. Any open request from this number (at any
   * branch) is replaced first; null if another request from the same number won a race.
   */
  async replaceOpenAndCreate(db: DbClient, platform: DbClient, data: NewServiceRequest, now: Date) {
    await platform.serviceRequest.updateMany({
      where: { phone: data.phone, status: OPEN },
      data: { status: 'cancelled', handledAt: now },
    });
    try {
      return await db.serviceRequest.create({ data, select: requestSelect });
    } catch (e) {
      if (isUniqueClash(e)) return null;
      throw e;
    }
  },

  /** Every request from a number, newest first, with its branch. Platform client. */
  async listForPhone(platform: DbClient, phone: string, limit = 10) {
    const rows = await platform.serviceRequest.findMany({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: requestSelect,
    });
    const shops = await platform.shop.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.shopId))] } },
      select: { id: true, name: true, city: true },
    });
    const byId = new Map(shops.map((s) => [s.id, s]));
    return rows.map((r) => ({ ...r, branch: byId.get(r.shopId) ?? null }));
  },

  /** Platform client: the customer cancelling their own open request. */
  async cancelForPhone(platform: DbClient, id: string, phone: string, now: Date): Promise<boolean> {
    const { count } = await platform.serviceRequest.updateMany({
      where: { id, phone, status: OPEN },
      data: { status: 'cancelled', handledAt: now },
    });
    return count === 1;
  },

  // ---------- The team (shop-scoped client) ----------

  async findById(db: DbClient, id: string) {
    return db.serviceRequest.findUnique({ where: { id }, select: requestSelect });
  },

  async list(db: DbClient, filter: 'open' | 'handled', limit = 100) {
    return db.serviceRequest.findMany({
      where: filter === 'open' ? { status: OPEN } : { status: { in: ['approved', 'rejected', 'cancelled'] } },
      orderBy: filter === 'open' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      take: limit,
      select: requestSelect,
    });
  },

  async countOpen(db: DbClient) {
    return db.serviceRequest.count({ where: { status: OPEN } });
  },

  /** Moves an open request on. False when it was already handled (or cancelled) meanwhile. */
  async decide(
    db: DbClient,
    id: string,
    data: {
      status: 'approved' | 'rejected';
      byUserId: string;
      now: Date;
      reason?: string | null;
      customerId?: string | null;
    },
  ): Promise<boolean> {
    const { count } = await db.serviceRequest.updateMany({
      where: { id, status: OPEN },
      data: {
        status: data.status,
        handledByUserId: data.byUserId,
        handledAt: data.now,
        reason: data.reason ?? null,
        customerId: data.customerId ?? null,
      },
    });
    return count === 1;
  },
};

export type ServiceRequestRow = NonNullable<Awaited<ReturnType<typeof serviceRequestRepo.findById>>>;
