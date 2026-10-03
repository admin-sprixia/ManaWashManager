import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { rewardRepo, serviceRepo, stockRepo, vehicleRepo } from '@mana/db';
import {
  GIFT_ITEMS_MAX,
  GIFT_QUANTITY_MAX,
  isRewardEligiblePlate,
  roundStock,
  STAMP_EVERY_MAX,
  STAMP_EVERY_MIN,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { reportWindowProblem, requirePro } from '../lib/plan';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import type { Env } from '../types';

const serviceParamSchema = z.object({ serviceId: z.string().min(1).max(64) });
const giftParamSchema = z.object({ id: z.string().min(1).max(200) });
const customerParamSchema = z.object({ customerId: z.string().min(1).max(64) });

const ruleSchema = z.object({
  every: z
    .number()
    .int('Use a whole number')
    .min(STAMP_EVERY_MIN, `At least ${STAMP_EVERY_MIN} washes`)
    .max(STAMP_EVERY_MAX, `At most ${STAMP_EVERY_MAX} washes`),
});

const giftSchema = z.object({
  items: z
    .array(
      z.object({
        stockItemId: z.string().min(1).max(64),
        quantity: z
          .number()
          .positive('Enter more than zero')
          .max(GIFT_QUANTITY_MAX, `At most ${GIFT_QUANTITY_MAX}`),
      }),
    )
    .max(GIFT_ITEMS_MAX, `At most ${GIFT_ITEMS_MAX} items in the welcome gift`)
    .refine((items) => new Set(items.map((i) => i.stockItemId)).size === items.length, 'Each item can be added once'),
});

const vehicleQuerySchema = z.object({
  registrationNumber: z
    .string()
    .transform((r) => r.trim().toUpperCase().replace(/\s+/g, ''))
    .refine((r) => r.length >= 4 && r.length <= 15, 'Enter a valid registration number'),
});

// Rewards are Pro. Everyone sees the cards and hands over owed gifts; setting up the stamp
// cards and the welcome gift, and the report, are the owner's.
export const rewardRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requirePro('rewards'))
  // The shop's stamp cards and welcome gift, and how many gifts are owed — cached on phones.
  .get('/settings', async (c) => {
    const db = c.get('db');
    const [rules, gift, owed] = await Promise.all([
      rewardRepo.listRules(db),
      rewardRepo.listGiftItems(db),
      rewardRepo.countOwed(db),
    ]);
    return c.json({
      rules: rules.filter((r) => r.active && r.serviceActive),
      gift: gift.filter((g) => g.active),
      giftsOwed: owed,
    });
  })
  // Turn a stamp card on for a service, or change how many washes it takes.
  .put(
    '/rules/:serviceId',
    requireRole('owner'),
    zValidator('param', serviceParamSchema),
    zValidator('json', ruleSchema),
    async (c) => {
      const { serviceId } = c.req.valid('param');
      const { every } = c.req.valid('json');
      const db = c.get('db');
      const service = await serviceRepo.findById(db, serviceId);
      if (!service || !service.active) {
        return c.json({ error: 'service_not_found' as const, message: 'This service isn’t on the price list.' }, 404);
      }
      const before = await rewardRepo.findRule(db, serviceId);
      await rewardRepo.saveRule(db, { serviceId, every, userId: c.get('session').sub });
      if (!before || !before.active || before.every !== every) await rewardRepo.touchVehiclesWithService(db, serviceId);
      return c.json({ ok: true as const, rules: (await rewardRepo.listRules(db)).filter((r) => r.active && r.serviceActive) });
    },
  )
  // Switch a card off. History stays; switching it back on picks up where every car was.
  .delete('/rules/:serviceId', requireRole('owner'), zValidator('param', serviceParamSchema), async (c) => {
    const { serviceId } = c.req.valid('param');
    const db = c.get('db');
    if (await rewardRepo.disableRule(db, serviceId, c.get('session').sub)) {
      await rewardRepo.touchVehiclesWithService(db, serviceId);
    }
    return c.json({ ok: true as const, rules: (await rewardRepo.listRules(db)).filter((r) => r.active && r.serviceActive) });
  })
  // Replace the welcome gift. Items must be in Inventory; pieces are whole numbers.
  .put('/gift', requireRole('owner'), zValidator('json', giftSchema), async (c) => {
    const { items } = c.req.valid('json');
    const db = c.get('db');
    const stock = await stockRepo.list(db);
    const byId = new Map(stock.map((s) => [s.id, s]));
    for (const item of items) {
      const found = byId.get(item.stockItemId);
      if (!found) {
        return c.json(
          { error: 'item_not_found' as const, message: 'One of the items isn’t in Inventory any more.' },
          400,
        );
      }
      if (found.unit === 'pcs' && !Number.isInteger(item.quantity)) {
        return c.json(
          { error: 'invalid_quantity' as const, message: `${found.name} is counted in pieces — use a whole number.` },
          400,
        );
      }
    }
    await rewardRepo.setGiftItems(
      db,
      items.map((i) => ({ stockItemId: i.stockItemId, quantity: roundStock(i.quantity) })),
      c.get('session').sub,
    );
    return c.json({ ok: true as const, gift: (await rewardRepo.listGiftItems(db)).filter((g) => g.active) });
  })
  // New Wash: this car's cards and owed gifts, live. `isNew` = no wash yet (gets the welcome gift).
  .get('/vehicle', zValidator('query', vehicleQuerySchema), async (c) => {
    const { registrationNumber } = c.req.valid('query');
    const db = c.get('db');
    if (!isRewardEligiblePlate(registrationNumber)) {
      return c.json({ eligible: false as const, vehicleId: null, isNew: false, cards: [], giftsOwed: [] });
    }
    const vehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
    if (!vehicle) return c.json({ eligible: true as const, vehicleId: null, isNew: true, cards: [], giftsOwed: [] });
    const now = new Date();
    const [cards, owed, liveJobs] = await Promise.all([
      rewardRepo.cardsForVehicles(db, [vehicle.id], now),
      rewardRepo.owedGifts(db, { vehicleIds: [vehicle.id] }),
      db.job.count({ where: { vehicleId: vehicle.id, status: { not: 'void' } } }),
    ]);
    return c.json({
      eligible: true as const,
      vehicleId: vehicle.id,
      isNew: liveJobs === 0,
      cards: cards.get(vehicle.id) ?? [],
      giftsOwed: owed,
    });
  })
  // Customer profile: every vehicle's cards, gifts owed, and gifts already handed over.
  .get('/customer/:customerId', zValidator('param', customerParamSchema), async (c) => {
    const { customerId } = c.req.valid('param');
    const db = c.get('db');
    const vehicles = await vehicleRepo.listForCustomer(db, customerId);
    const eligible = vehicles.filter((v) => isRewardEligiblePlate(v.registrationNumber));
    const ids = eligible.map((v) => v.id);
    if (ids.length === 0) return c.json({ vehicles: [], giftsOwed: [], giftsGiven: [] });
    const [cards, gifts] = await Promise.all([
      rewardRepo.cardsForVehicles(db, ids, new Date()),
      rewardRepo.giftsForVehicles(db, ids),
    ]);
    return c.json({
      vehicles: eligible.map((v) => ({
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        cards: cards.get(v.id) ?? [],
      })),
      giftsOwed: gifts.filter((g) => g.status === 'owed'),
      giftsGiven: gifts.filter((g) => g.status === 'given'),
    });
  })
  // Every gift still owed, oldest first, with who it's for.
  .get('/gifts/owed', async (c) => {
    const db = c.get('db');
    return c.json({ gifts: await rewardRepo.owedGiftsWithCustomers(db) });
  })
  // Hand over an owed gift (takes it out of stock). Safe to repeat.
  .post('/gifts/:id/give', zValidator('param', giftParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const result = await rewardRepo.give(db, id, { userId: c.get('session').sub, now: new Date() });
    if (result.ok) return c.json({ ok: true as const, gift: result.gift });
    if (result.error === 'gift_not_found') {
      return c.json({ error: result.error, message: 'This gift isn’t there any more.' }, 404);
    }
    if (result.error === 'out_of_stock') {
      const name = result.gift?.itemName ?? 'this item';
      return c.json(
        {
          error: result.error,
          message: `Not enough ${name} in stock. Add the new stock in Inventory, then hand it over.`,
          gift: result.gift,
        },
        409,
      );
    }
    return c.json(
      { error: result.error, message: 'This gift was cancelled — its wash was voided.', gift: result.gift },
      409,
    );
  })
  // Owner report: free washes used and what they were worth, gifts handed over, gifts owed now.
  .get('/report', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);
    const tooFarBack = reportWindowProblem(c.get('plan'), window.from);
    if (tooFarBack) return c.json(tooFarBack, 402);
    return c.json({ ...(await rewardRepo.report(db, window.from, window.to)), ...windowMeta(query, window) });
  });
