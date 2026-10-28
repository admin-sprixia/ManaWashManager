import { describe, expect, it } from 'vitest';
import { catalogFeed, catalogProducts, type ChatBranch } from '../index';

const branch: ChatBranch = {
  id: 'b1',
  name: 'Kovur',
  city: 'Kovur',
  address: null,
  phone: null,
  location: null,
  hours: { opensAt: null, closesAt: null, weeklyOff: null },
  reviewUrl: null,
  vehicleTypes: [
    { id: 'hatch', name: 'Hatchback', category: 'car', bodyKey: 'hatch' },
    { id: 'sedan', name: 'Sedan', category: 'car', bodyKey: 'sedan' },
    { id: 'suvMini', name: 'Compact SUV', category: 'car', bodyKey: 'suvMini' },
    { id: 'truck', name: 'Truck (6 wheels)', category: 'car', bodyKey: 'truck' },
    { id: 'scooter', name: 'Scooter', category: 'bike', bodyKey: 'scooter' },
  ],
  services: [
    {
      id: 'basic',
      name: 'Basic Wash',
      popular: true,
      description: 'Outside and inside.',
      checklist: ['Full vacuum', 'Inside glass'],
      durationMin: 45,
      prices: [
        { vehicleTypeId: 'hatch', price: 47100 },
        { vehicleTypeId: 'sedan', price: 54900 },
        { vehicleTypeId: 'suvMini', price: 54900 },
        { vehicleTypeId: 'truck', price: 99900 },
        { vehicleTypeId: 'scooter', price: 14900 },
      ],
    },
  ],
  plans: [
    {
      name: 'Basic Plan',
      washes: 4,
      months: 1,
      popular: true,
      serviceName: 'Basic Wash',
      upgrade: null,
      prices: [{ vehicleTypeId: 'sedan', total: 219900, listTotal: 219600 + 1000 }],
    },
  ],
};

describe('WhatsApp catalog', () => {
  it('lists each wash and plan once per kind of vehicle, at the shop price', () => {
    const products = catalogProducts(branch);
    expect(products.map((p) => p.id)).toEqual(['basic-wash--hatch', 'basic-wash--sedan', 'basic-plan--sedan', 'basic-wash--scooter']);
    const sedan = products.find((p) => p.id === 'basic-wash--sedan')!;
    expect(sedan.price).toBe(54900);
    expect(sedan.section.label).toBe('Sedans & Compact SUVs');
    expect(sedan.description).toContain('For Sedan, Compact SUV.');
    expect(sedan.description).toContain('✓ Full vacuum');
    expect(sedan.description).toContain('Takes about 45 minutes.');
    // Communities aren't offered yet, so nothing about them is listed.
    const withCommunity = { ...branch, services: [{ ...branch.services[0]!, description: 'Done at the shop. Community customers get free pick-up.' }] };
    expect(catalogProducts(withCommunity)[0]!.description).not.toMatch(/community/i);
    // Trucks aren't in the shop's catalog.
    expect(products.some((p) => p.id.includes('truck'))).toBe(false);
  });

  it('describes a plan by its washes and what it costs each time', () => {
    const plan = catalogProducts(branch).find((p) => p.kind === 'plan')!;
    expect(plan.card.lines).toEqual(['4 washes in a month', 'A Basic Wash each time', 'Just ₹550 a wash']);
    expect(plan.description).toContain('You save ₹7.');
  });

  it('writes a CSV feed Commerce Manager can read', () => {
    const csv = catalogFeed(branch, { brand: 'Sri Mana Wash', link: 'https://srimanawash.com/', imageUrl: (id) => `https://x/${id}.jpg` });
    const [head, first] = csv.split('\n');
    expect(head).toBe('id,title,description,availability,condition,price,link,image_link,brand,custom_label_0,custom_label_1');
    expect(first).toMatch(/^"basic-wash--hatch","Basic Wash · Hatchbacks","For Hatchback\./);
    expect(csv).toContain('"471.00 INR","https://srimanawash.com/","https://x/basic-wash--hatch.jpg","Sri Mana Wash","Hatchbacks","Washes"');
  });
});
