import { directoryRepo, rewardRepo, type DbClient } from '@mana/db';
import { isRewardEligiblePlate, REWARD_DISCOUNT_REASON, type PlanStatus } from '@mana/domain';

type Line = { serviceId: string; priceAtTime: number };

/**
 * Checks that every service asked for as a free wash is on the bill and has a free wash
 * waiting on this car's card right now. The discount is one of each, at this car's price.
 */
export async function checkFreeWashes(
  db: DbClient,
  data: { registrationNumber: string; serviceIds: string[]; lineItems: Line[]; jobId: string; now: Date },
): Promise<
  | { ok: true; vehicleId: string; discount: number; reason: string; seqs: Map<string, number> }
  | { ok: false; message: string }
> {
  if (!isRewardEligiblePlate(data.registrationNumber)) {
    return { ok: false, message: 'Walk-in washes don’t collect stamps.' };
  }
  const vehicle = await db.vehicle.findFirst({
    where: { registrationNumber: data.registrationNumber },
    select: { id: true },
  });
  if (!vehicle) return { ok: false, message: 'This vehicle has no stamp card yet.' };
  // Claims strictly before the cards: see `claimsInProgress`.
  const claims = await rewardRepo.claimsInProgress(db, { vehicleId: vehicle.id, jobId: data.jobId, now: data.now });
  const cards = (await rewardRepo.cardsForVehicles(db, [vehicle.id], data.now)).get(vehicle.id) ?? [];
  const lineFor = new Map(data.lineItems.map((l) => [l.serviceId, l]));
  let discount = 0;
  const names: string[] = [];
  const seqs = new Map<string, number>();
  for (const serviceId of data.serviceIds) {
    const line = lineFor.get(serviceId);
    if (!line) return { ok: false, message: 'Add the free service to the bill to use it.' };
    const card = cards.find((c) => c.serviceId === serviceId);
    const claim = claims.get(serviceId) ?? { nextSeq: 1, inFlight: 0 };
    if (!card || card.free - claim.inFlight < 1) {
      return { ok: false, message: 'This free wash isn’t available any more. Check the card again.' };
    }
    discount += line.priceAtTime;
    names.push(card.serviceName);
    seqs.set(serviceId, claim.nextSeq);
  }
  return {
    ok: true,
    vehicleId: vehicle.id,
    discount,
    reason: `${REWARD_DISCOUNT_REASON} · Free ${names.join(' + ')}`,
    seqs,
  };
}

/**
 * Runs after a wash is paid (and again on a retried payment — every step is idempotent): a car's
 * first paid wash gets the welcome gift, and the car's cards changed, so phones re-pull it.
 * Pro only; walk-in plates are skipped. True when a welcome gift was written for this wash.
 */
export async function settleRewardsForPaidJob(
  db: DbClient,
  jobId: string,
  plan: PlanStatus,
  userId: string,
): Promise<boolean> {
  if (plan.tier !== 'pro') return false;
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, vehicleId: true, customerId: true, createdAt: true, vehicle: { select: { registrationNumber: true } } },
  });
  if (!job || job.status !== 'paid' || !isRewardEligiblePlate(job.vehicle.registrationNumber)) return false;
  const [items, rules, first] = await Promise.all([
    rewardRepo.listGiftItems(db),
    db.rewardRule.count({ where: { active: true } }),
    rewardRepo.isFirstVisit(db, job),
  ]);
  const giftItems = items.filter((i) => i.active);
  const gifted = first && giftItems.length > 0;
  if (gifted) {
    await rewardRepo.issueForPaidJob(db, {
      job,
      registrationNumber: job.vehicle.registrationNumber,
      items: giftItems.map((i) => ({ stockItemId: i.stockItemId, quantity: i.quantity })),
      userId,
      now: new Date(),
    });
  }
  if (rules > 0 || gifted) await directoryRepo.touchCustomer(db, job.customerId);
  return gifted;
}
