import type { DbClient } from '../client';

export type CouponCancelReason = 'replaced' | 'owner_changed' | 'referral_voided';
export type CouponKind = 'comeback' | 'referral';

const couponInclude = {
  vehicle: { select: { id: true, registrationNumber: true, customerId: true } },
  customer: { select: { id: true, name: true, phone: true } },
} as const;

function istDate(at: Date): string {
  return at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

function ownerLabel(name: string | null): string {
  return name?.trim() ? `${name.trim().split(/\s+/)[0]}’s` : 'the same owner’s';
}

export const couponRepo = {
  async findByCode(db: DbClient, code: string) {
    return db.coupon.findFirst({ where: { code }, include: couponInclude });
  },

  /**
   * Issues a fresh coupon for a vehicle, replacing any live one of the same kind. The partial
   * unique index (one active coupon per vehicle per kind) makes a concurrent double-issue fail
   * instead of stacking.
   */
  async issue(
    db: DbClient,
    data: {
      kind?: CouponKind;
      vehicleId: string;
      customerId: string;
      code: string;
      percent: number;
      expiresAt: Date;
      issuedByUserId: string;
      now: Date;
    },
  ) {
    const kind = data.kind ?? 'comeback';
    await this.cancelActiveForVehicle(db, data.vehicleId, 'replaced', data.now, kind);
    return db.coupon.create({
      data: {
        code: data.code,
        kind,
        vehicleId: data.vehicleId,
        customerId: data.customerId,
        percent: data.percent,
        expiresAt: data.expiresAt,
        issuedByUserId: data.issuedByUserId,
        createdAt: data.now,
      },
      include: couponInclude,
    });
  },

  /** Cancels live coupons on a vehicle — one kind, or every kind when `kind` is omitted. */
  async cancelActiveForVehicle(
    db: DbClient,
    vehicleId: string,
    reason: CouponCancelReason,
    now: Date,
    kind?: CouponKind,
  ) {
    return db.coupon.updateMany({
      where: { vehicleId, status: 'active', ...(kind ? { kind } : {}) },
      data: { status: 'cancelled', cancelReason: reason, cancelledAt: now },
    });
  },

  /** A referrer holds at most one unused referral coupon at a time. */
  async hasLiveReferralCoupon(db: DbClient, customerId: string, now: Date) {
    const count = await db.coupon.count({
      where: { customerId, kind: 'referral', status: 'active', expiresAt: { gt: now } },
    });
    return count > 0;
  },

  /** Takes back an unused referral reward when the wash that earned it is voided. */
  async cancelIfUnused(db: DbClient, couponId: string, reason: CouponCancelReason, now: Date) {
    const res = await db.coupon.updateMany({
      where: { id: couponId, status: 'active' },
      data: { status: 'cancelled', cancelReason: reason, cancelledAt: now },
    });
    return res.count === 1;
  },

  async markNotified(db: DbClient, couponId: string, now: Date) {
    await db.coupon.updateMany({ where: { id: couponId }, data: { notifiedAt: now } });
  },

  /** Live referral rewards nobody has sent to the customer yet — they count toward the bell. */
  async countUnsentReferral(db: DbClient, now: Date) {
    return db.coupon.count({
      where: { kind: 'referral', status: 'active', expiresAt: { gt: now }, notifiedAt: null },
    });
  },

  /**
   * The best live coupon this vehicle can use right now, if its owner is the one standing at
   * the counter: issued to the vehicle's current owner, for a vehicle they still own.
   */
  async findUsable(db: DbClient, data: { registrationNumber: string; phone: string; now: Date }) {
    const vehicle = await db.vehicle.findFirst({
      where: { registrationNumber: data.registrationNumber },
      include: { customer: { select: { phone: true } } },
    });
    if (!vehicle || vehicle.customer.phone !== data.phone) return null;
    return db.coupon.findFirst({
      where: {
        status: 'active',
        expiresAt: { gt: data.now },
        customerId: vehicle.customerId,
        vehicle: { customerId: vehicle.customerId },
      },
      orderBy: [{ percent: 'desc' }, { expiresAt: 'asc' }],
      include: couponInclude,
    });
  },

  /**
   * Every rule a coupon must pass before a wash may use it. `jobId` lets a replayed request
   * (same client job id) pass even though its earlier attempt already claimed the coupon.
   */
  async checkRedeemable(
    db: DbClient,
    data: { code: string; registrationNumber: string; phone: string; jobId: string; now: Date },
  ) {
    const coupon = await this.findByCode(db, data.code);
    const fail = (message: string) => ({ error: 'coupon_invalid' as const, message });
    if (!coupon) return fail('This coupon code doesn’t exist.');

    if (coupon.status === 'cancelled') {
      return fail(
        coupon.cancelReason === 'owner_changed'
          ? 'This coupon was cancelled because the vehicle changed owners.'
          : 'This coupon was replaced by a newer one.',
      );
    }
    if (coupon.status === 'redeemed' && coupon.redeemedJobId !== data.jobId) {
      return fail(
        `This coupon was already used${coupon.redeemedAt ? ` on ${istDate(coupon.redeemedAt)}` : ''}.`,
      );
    }
    if (coupon.status === 'active' && coupon.expiresAt.getTime() <= data.now.getTime()) {
      return fail(`This coupon expired on ${istDate(coupon.expiresAt)}.`);
    }
    if (coupon.vehicle.customerId !== coupon.customerId) {
      await this.cancelActiveForVehicle(db, coupon.vehicleId, 'owner_changed', data.now);
      return fail('This coupon was cancelled because the vehicle changed owners.');
    }

    const onlyFor = `Only valid for ${coupon.vehicle.registrationNumber} or ${ownerLabel(coupon.customer.name)} other vehicles.`;
    const target = await db.vehicle.findFirst({
      where: { registrationNumber: data.registrationNumber },
      select: { id: true, customerId: true },
    });
    if (!target || target.customerId !== coupon.customerId) return fail(onlyFor);
    if (coupon.customer.phone !== data.phone) {
      return fail(`Only valid with the owner’s own number on file.`);
    }
    return { coupon };
  },

  /**
   * Atomically claims the coupon for `jobId`: a single conditional UPDATE, so two phones
   * redeeming the same code at the same moment can't both win.
   */
  async claim(db: DbClient, data: { couponId: string; jobId: string; userId: string; now: Date }) {
    const res = await db.coupon.updateMany({
      where: {
        id: data.couponId,
        OR: [
          { status: 'active', expiresAt: { gt: data.now } },
          { status: 'redeemed', redeemedJobId: data.jobId },
        ],
      },
      data: {
        status: 'redeemed',
        redeemedJobId: data.jobId,
        redeemedByUserId: data.userId,
        redeemedAt: data.now,
      },
    });
    return res.count === 1;
  },

  /** Undo a claim whose job never got written. */
  async release(db: DbClient, data: { couponId: string; jobId: string }) {
    await db.coupon.updateMany({
      where: { id: data.couponId, status: 'redeemed', redeemedJobId: data.jobId },
      data: { status: 'active', redeemedJobId: null, redeemedByUserId: null, redeemedAt: null },
    });
  },

  /**
   * A voided wash hands its coupon back — only while it's still in date, the vehicle still
   * belongs to the same owner, and no newer coupon has been issued for that vehicle.
   */
  async restoreForVoidedJob(db: DbClient, jobId: string, now: Date) {
    const coupon = await db.coupon.findUnique({
      where: { redeemedJobId: jobId },
      include: couponInclude,
    });
    if (!coupon || coupon.status !== 'redeemed') return null;
    if (coupon.expiresAt.getTime() <= now.getTime()) return null;
    if (coupon.vehicle.customerId !== coupon.customerId) return null;
    const live = await db.coupon.count({
      where: { vehicleId: coupon.vehicleId, kind: coupon.kind, status: 'active' },
    });
    if (live > 0) return null;
    try {
      await this.release(db, { couponId: coupon.id, jobId });
      return coupon.id;
    } catch {
      return null;
    }
  },

  /** Live and recently used coupons for the Reminders screen. */
  async listRecent(db: DbClient, now: Date, since: Date) {
    const include = {
      ...couponInclude,
      issuedBy: { select: { id: true, name: true } },
      redeemedBy: { select: { id: true, name: true } },
      referrals: { select: { referred: { select: { name: true } } }, take: 1 },
    } as const;
    const [active, redeemed] = await Promise.all([
      db.coupon.findMany({
        where: { status: 'active', expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
        take: 100,
        include,
      }),
      db.coupon.findMany({
        where: { status: 'redeemed', redeemedAt: { gte: since } },
        orderBy: { redeemedAt: 'desc' },
        take: 50,
        include,
      }),
    ]);
    return { active, redeemed };
  },
};
