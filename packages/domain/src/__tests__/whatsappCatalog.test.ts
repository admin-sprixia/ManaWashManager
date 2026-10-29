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
    expect(products.map((p) => p.id)).toEqual(['basic-wash--small', 'basic-wash--mid', 'basic-plan--mid', 'basic-wash--bike']);
    const sedan = products.find((p) => p.id === 'basic-wash--mid')!;
    expect(sedan.price).toBe(54900);
    expect(sedan.section.label).toBe('Mid-size Cars');
    expect(sedan.description).toContain('For Dzire, City, Nexon, Brezza, BMW 3 Series and similar.');
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

  it('lists an add-on as one, for every size', () => {
    const care = {
      id: 'care',
      name: 'Premium Care',
      popular: false,
      kind: 'addon' as const,
      description: 'Gentle shampoo, microfiber hand-dry, extra paint care.',
      checklist: [],
      durationMin: 15,
      prices: [{ vehicleTypeId: 'hatch', price: 24900 }],
    };
    const p = catalogProducts({ ...branch, services: [...branch.services, care] }).find((x) => x.title === 'Premium Care')!;
    expect(p.id).toBe('premium-care--small');
    expect(p.kind).toBe('addon');
    expect(p.description).toBe('Add-on to a Basic Wash. For Swift, i20, Baleno, Kwid, Mini Cooper and similar.\nGentle shampoo, microfiber hand-dry, extra paint care.\n\nAdds about 15 minutes.');
    expect(p.card).toEqual({ subtitle: 'Gentle shampoo, microfiber hand-dry, extra paint care.', lines: ['Add to Basic Wash'], footer: 'Adds 15 min', popular: false });
  });

  it('leaves out what isn’t on sale yet', () => {
    const soon = { ...branch, services: [...branch.services, { ...branch.services[0]!, id: 'care', name: 'Premium Care', kind: 'addon' as const, comingSoon: true }] };
    expect(catalogProducts(soon).some((p) => p.title === 'Premium Care')).toBe(false);
  });

  it('writes a CSV feed Commerce Manager can read', () => {
    const csv = catalogFeed(branch, { brand: 'Sri Mana Wash', link: 'https://srimanawash.com/', imageUrl: (id) => `https://x/${id}.jpg` });
    const [head, first] = csv.split('\n');
    expect(head).toBe('id,title,description,availability,condition,price,link,image_link,brand,custom_label_0,custom_label_1');
    expect(first).toMatch(/^"basic-wash--small","Basic Wash · Small Cars","For Swift, i20, Baleno, Kwid, Mini Cooper and similar\./);
    expect(csv).toContain('"471.00 INR","https://srimanawash.com/","https://x/basic-wash--small.jpg","Sri Mana Wash","Small Cars","Washes"');
  });
});
