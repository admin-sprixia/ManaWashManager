import { describe, expect, it } from 'vitest';
import {
  BODY_TYPES,
  DEFAULT_PRICING_POLICY,
  DEFAULT_SERVICE_DETAILS,
  VEHICLE_CLASSES,
  appliesToForClasses,
  basePriceKey,
  bodyTypeForName,
  branchCapabilities,
  branchPriceKey,
  checkOverride,
  effectivePrice,
  listPrice,
  overrideRange,
  parsePricingPolicy,
  planBranchMenu,
  vehicleClassDef,
  type BranchPlanInput,
  type ModeAdjustment,
} from '../index';

const DOORSTEP: ModeAdjustment[] = [
  { mode: 'doorstep', classKey: null, percentBp: 1500, fixedPaise: 0, minExtraPaise: 5000 },
  { mode: 'doorstep', classKey: 'farm', percentBp: 0, fixedPaise: 30000, minExtraPaise: 0 },
];

describe('vehicle catalog', () => {
  it('gives every body type a known class and a size that class has', () => {
    for (const b of BODY_TYPES) {
      const c = vehicleClassDef(b.classKey);
      expect(c, b.key).not.toBeNull();
      expect(c!.sizes).toContain(b.size);
    }
    expect(new Set(BODY_TYPES.map((b) => b.key)).size).toBe(BODY_TYPES.length);
    expect(VEHICLE_CLASSES.map((c) => c.key)).toEqual(['twoWheeler', 'car', 'threeWheeler', 'commercial', 'heavy', 'farm']);
  });

  it('recognises hand-typed names, specific before broad', () => {
    expect(bodyTypeForName('Mini SUV')?.key).toBe('suvMini');
    expect(bodyTypeForName('Large SUV / XUV')?.key).toBe('suvLarge');
    expect(bodyTypeForName('Sports bike')?.key).toBe('sportsBike');
    expect(bodyTypeForName('Hatchback')?.key).toBe('hatch');
    expect(bodyTypeForName('Mini truck')?.key).toBe('miniTruck');
    expect(bodyTypeForName('Something else')).toBeNull();
  });
});

describe('list price', () => {
  const base = { mode: 'hub' as const, classKey: 'car', adjustments: DOORSTEP, zonePercentBp: 0, roundToPaise: 1000 };

  it('is the base price at the hub', () => {
    expect(listPrice({ ...base, base: 50000 }).price).toBe(50000);
  });

  it('adds the doorstep extra, at least the minimum', () => {
    expect(listPrice({ ...base, base: 70000, mode: 'doorstep' }).price).toBe(81000); // +15% = 80500, to the nearest ₹10
    expect(listPrice({ ...base, base: 20000, mode: 'doorstep' }).price).toBe(25000); // 15% = 3000 < 5000 minimum
  });

  it('uses a class-specific rule over the all-classes one', () => {
    expect(listPrice({ ...base, base: 150000, classKey: 'farm', mode: 'doorstep' }).price).toBe(180000);
  });

  it('applies the zone after the delivery extra, then rounds', () => {
    const p = listPrice({ ...base, base: 50000, mode: 'doorstep', zonePercentBp: 1000 });
    // 50000 + 7500 = 57500, +10% = 63250, rounded to ₹10 = 63000
    expect(p.price).toBe(63000);
    expect(p.steps.map((s) => s.label)).toEqual(['Base price', 'Community extra', 'Zone', 'Rounded']);
  });

  it('uses a doorstep price set for the size instead of the doorstep rule', () => {
    const own = { ...base, base: 29900, doorstepBase: 26900, roundToPaise: 100 };
    expect(listPrice({ ...own, mode: 'doorstep' }).price).toBe(26900);
    expect(listPrice({ ...own, mode: 'hub' }).price).toBe(29900);
    expect(listPrice({ ...own, mode: 'doorstep', zonePercentBp: -1000 }).price).toBe(24200);
  });
});

describe('branch overrides', () => {
  const policy = DEFAULT_PRICING_POLICY;

  it('allows prices within the policy range', () => {
    expect(overrideRange(50000, policy)).toEqual({ min: 40000, max: 60000 });
    expect(checkOverride(50000, 55000, policy)).toBe('ok');
    expect(checkOverride(50000, 65000, policy)).toBe('out_of_range');
    expect(checkOverride(50000, 55000, { ...policy, branchOverrides: false })).toBe('not_allowed');
  });

  it('pulls a stale override back into range and ignores it when switched off', () => {
    expect(effectivePrice(50000, 90000, policy)).toEqual({ price: 60000, overridden: true });
    expect(effectivePrice(50000, 55000, { ...policy, branchOverrides: false })).toEqual({ price: 50000, overridden: false });
    expect(effectivePrice(50000, null, policy)).toEqual({ price: 50000, overridden: false });
  });

  it('parses stored policy values field by field', () => {
    expect(parsePricingPolicy({})).toEqual(DEFAULT_PRICING_POLICY);
    expect(parsePricingPolicy({ branchOverrides: 'false', maxIncreasePct: '35' })).toEqual({
      ...DEFAULT_PRICING_POLICY,
      branchOverrides: false,
      maxIncreasePct: 35,
    });
    // Rounding is always to the rupee, whatever an old setting says.
    expect(parsePricingPolicy({ roundToPaise: '1000' }).roundToPaise).toBe(100);
  });
});

describe('branch capabilities', () => {
  const all = VEHICLE_CLASSES.map((c) => c.key);

  it('treats a branch without service points as a hub that washes everything', () => {
    const caps = branchCapabilities([], all);
    expect(caps.modes).toEqual(['hub']);
    expect([...caps.classKeys].sort()).toEqual([...all].sort());
  });

  it('combines the active points', () => {
    const caps = branchCapabilities(
      [
        { kind: 'doorstep', active: true, classKeys: ['car', 'farm'] },
        { kind: 'hub', active: false, classKeys: ['heavy'] },
      ],
      all,
    );
    expect(caps.modes).toEqual(['doorstep']);
    expect([...caps.classKeys].sort()).toEqual(['car', 'farm']);
  });

  it('keeps the classes of each way apart', () => {
    const caps = branchCapabilities(
      [
        { kind: 'hub', active: true, classKeys: ['car', 'twoWheeler'] },
        { kind: 'doorstep', active: true, classKeys: ['car', 'farm'] },
      ],
      all,
    );
    expect(caps.modes).toEqual(['hub', 'doorstep']);
    expect([...caps.classesByMode.get('hub')!].sort()).toEqual(['car', 'twoWheeler']);
    expect([...caps.classesByMode.get('doorstep')!].sort()).toEqual(['car', 'farm']);
  });
});

describe('planBranchMenu', () => {
  const services = [
    { id: 'wash', name: 'Complete wash', description: null, modes: 'both' as const, classKeys: ['car', 'twoWheeler', 'farm'], includes: [], sortOrder: 0, active: true },
    { id: 'under', name: 'Underbody', description: null, modes: 'hub' as const, classKeys: ['car'], includes: [], sortOrder: 1, active: true },
    { id: 'combo', name: 'Combo', description: null, modes: 'both' as const, classKeys: ['car'], includes: ['wash', 'under'], sortOrder: 2, active: true },
    { id: 'off', name: 'Retired', description: null, modes: 'both' as const, classKeys: ['car'], includes: [], sortOrder: 3, active: false },
  ];
  const basePrices = new Map([
    [basePriceKey('wash', 'car', 'S'), 40000],
    [basePriceKey('wash', 'car', 'L'), 70000],
    [basePriceKey('wash', 'farm', 'L'), 150000],
    [basePriceKey('under', 'car', 'S'), 50000],
    [basePriceKey('combo', 'car', 'S'), 80000],
    [basePriceKey('off', 'car', 'S'), 1000],
  ]);
  const input: BranchPlanInput = {
    services,
    basePrices,
    adjustments: DOORSTEP,
    policy: DEFAULT_PRICING_POLICY,
    zonePercentBp: 0,
    classesByMode: new Map([
      ['hub', new Set(['car', 'twoWheeler'])],
      ['doorstep', new Set(['car', 'twoWheeler'])],
    ]),
    vehicles: [
      { vehicleTypeId: 'vt_hatch', classKey: 'car', sizeKey: 'S' },
      { vehicleTypeId: 'vt_suv', classKey: 'car', sizeKey: 'L' },
      { vehicleTypeId: 'vt_tractor', classKey: 'farm', sizeKey: 'L' },
      { vehicleTypeId: 'vt_unlinked', classKey: null, sizeKey: null },
    ],
    hidden: new Set(),
    overrides: new Map(),
  };

  const priceOf = (plan: ReturnType<typeof planBranchMenu>, s: string, vt: string, mode: string) =>
    plan.prices.find((p) => p.catalogServiceId === s && p.vehicleTypeId === vt && p.mode === mode)?.price;

  it('prices each vehicle type for every way the branch and the service both allow', () => {
    const plan = planBranchMenu(input);
    expect(priceOf(plan, 'wash', 'vt_hatch', 'hub')).toBe(40000);
    expect(priceOf(plan, 'wash', 'vt_hatch', 'doorstep')).toBe(46000);
    expect(priceOf(plan, 'under', 'vt_hatch', 'hub')).toBe(50000);
    expect(priceOf(plan, 'under', 'vt_hatch', 'doorstep')).toBeUndefined();
    expect(priceOf(plan, 'under', 'vt_suv', 'hub')).toBeUndefined(); // no base price for L
    expect(plan.services.map((s) => s.catalogServiceId)).toEqual(['wash', 'under', 'combo']);
  });

  it('sells a service only for the sizes it is for, even where another size has a price', () => {
    const smallOnly = { ...services[0]!, sizeKeys: ['car|S'] };
    const plan = planBranchMenu({ ...input, services: [smallOnly] });
    expect(priceOf(plan, 'wash', 'vt_hatch', 'hub')).toBe(40000);
    expect(priceOf(plan, 'wash', 'vt_suv', 'hub')).toBeUndefined(); // L is priced, but not one of its sizes
  });

  it('leaves out classes the branch does not wash and unlinked vehicle types', () => {
    const plan = planBranchMenu(input);
    expect(plan.prices.some((p) => p.vehicleTypeId === 'vt_tractor')).toBe(false);
    expect(plan.prices.some((p) => p.vehicleTypeId === 'vt_unlinked')).toBe(false);
    const withFarm = planBranchMenu({
      ...input,
      classesByMode: new Map([
        ['hub', new Set(['car'])],
        ['doorstep', new Set(['car', 'farm'])],
      ]),
    });
    expect(priceOf(withFarm, 'wash', 'vt_tractor', 'doorstep')).toBe(180000);
    // A home wash is charged the hub price (plus a visit charge), even for a class only the team takes.
    expect(priceOf(withFarm, 'wash', 'vt_tractor', 'hub')).toBe(150000);
  });

  it('gives no hub price for homes to a service the team does only at communities', () => {
    const communityOnly = { ...services[0]!, modes: 'doorstep' as const, details: { ...DEFAULT_SERVICE_DETAILS, teamAt: 'community' as const } };
    const plan = planBranchMenu({
      ...input,
      services: [communityOnly],
      classesByMode: new Map([
        ['hub', new Set(['car'])],
        ['doorstep', new Set(['car', 'farm'])],
      ]),
    });
    expect(priceOf(plan, 'wash', 'vt_tractor', 'hub')).toBeUndefined();
    expect(priceOf(plan, 'wash', 'vt_hatch', 'hub')).toBeUndefined();
    expect(priceOf(plan, 'wash', 'vt_hatch', 'doorstep')).toBeDefined();
  });

  it('drops a hub-only service at a doorstep-only branch, and combo items it cannot offer', () => {
    const plan = planBranchMenu({ ...input, classesByMode: new Map([['doorstep', new Set(['car'])]]) });
    expect(plan.services.map((s) => s.catalogServiceId)).toEqual(['wash', 'combo']);
    expect(plan.services.find((s) => s.catalogServiceId === 'combo')?.includes).toEqual(['wash']);
  });

  it('applies branch overrides within the policy and honours hidden services', () => {
    const plan = planBranchMenu({
      ...input,
      overrides: new Map([[branchPriceKey('wash', 'vt_hatch', 'hub'), 44000]]),
      hidden: new Set(['under']),
    });
    const line = plan.prices.find((p) => p.catalogServiceId === 'wash' && p.vehicleTypeId === 'vt_hatch' && p.mode === 'hub');
    expect(line).toMatchObject({ price: 44000, listPrice: 40000, source: 'override' });
    expect(plan.services.map((s) => s.catalogServiceId)).not.toContain('under');

    const locked = planBranchMenu({
      ...input,
      hidden: new Set(['under']),
      policy: { ...DEFAULT_PRICING_POLICY, branchCanHideServices: false },
    });
    expect(locked.services.map((s) => s.catalogServiceId)).toContain('under');
  });

  it('files services under cars, bikes or both from their classes', () => {
    expect(appliesToForClasses(['car', 'farm'])).toBe('car');
    expect(appliesToForClasses(['twoWheeler'])).toBe('bike');
    expect(appliesToForClasses(['car', 'twoWheeler'])).toBe('both');
  });
});
