import { describe, expect, it } from 'vitest';
import {
  chatFlowChoice,
  chatFlowReply,
  chatFlowToken,
  chatReply,
  WA_FLOW_JSON,
  findModels,
  rateChoiceId,
  vehicleGuideRows,
  WA_BUTTON_TITLE_MAX,
  WA_FOOTER_MAX,
  WA_ID_MAX,
  WA_MAX_BUTTONS,
  WA_MAX_LIST_ROWS,
  WA_ROW_DESCRIPTION_MAX,
  WA_ROW_TITLE_MAX,
  type ChatBranch,
  type ChatContext,
  type ChatMessage,
  type ChatPerson,
} from '../index';

/** Rupee prices for the car types: [small, mid-size, large]. */
const car = (small: number, mid: number, large: number) => [
  { vehicleTypeId: 'hatch', price: small * 100 },
  { vehicleTypeId: 'sedan', price: mid * 100 },
  { vehicleTypeId: 'compact', price: mid * 100 },
  { vehicleTypeId: 'suv', price: large * 100 },
];
/** Plan totals and what the washes would cost one by one, [small, large]. */
const plan = (small: [number, number], large: [number, number]) => [
  { vehicleTypeId: 'hatch', total: small[0] * 100, listTotal: small[1] * 100 },
  { vehicleTypeId: 'suv', total: large[0] * 100, listTotal: large[1] * 100 },
];

/** The Kovur hub as the menu has it: three car sizes, three bike types, Premium Care, plans. */
const hub: ChatBranch = {
  id: 'b1',
  name: 'Kovur',
  city: 'Kovur',
  address: 'Near Highway, Sai Baba Temple, Kovur',
  phone: '9154752999',
  location: { latitude: 14.49, longitude: 79.98 },
  hours: { opensAt: '07:00', closesAt: '20:00', weeklyOff: null, weeklyOffDays: [] },
  reviewUrl: 'https://g.page/r/abc/review',
  vehicleTypes: [
    { id: 'hatch', name: 'Hatchback', category: 'car', bodyKey: 'hatch' },
    { id: 'sedan', name: 'Sedan', category: 'car', bodyKey: 'sedan' },
    { id: 'compact', name: 'Compact SUV', category: 'car', bodyKey: 'suvMini' },
    { id: 'suv', name: 'SUV', category: 'car', bodyKey: 'suvLarge' },
    { id: 'scooter', name: 'Scooter', category: 'bike', bodyKey: 'scooter' },
    { id: 'bike', name: 'Bike', category: 'bike', bodyKey: 'bike' },
    { id: 'big', name: 'Premium bike', category: 'bike', bodyKey: 'premiumBike' },
  ],
  services: [
    {
      id: 'express',
      name: 'Express Wash',
      popular: false,
      kind: 'wash',
      description: 'A quick, careful outside wash.',
      checklist: ['Snow foam', 'Two-bucket hand wash', 'Tyre shine'],
      durationMin: 25,
      prices: car(299, 349, 419),
    },
    { id: 'basic', name: 'Basic Wash', popular: true, kind: 'wash', prices: car(499, 599, 799) },
    { id: 'premium', name: 'Premium Wash', popular: false, kind: 'wash', prices: car(899, 1099, 1399) },
    { id: 'rust', name: 'Anti-Rust Protection', popular: false, kind: 'protection', prices: car(4500, 4500, 4500) },
    {
      id: 'care',
      name: 'Premium Care',
      popular: false,
      kind: 'addon',
      description: 'Gentle shampoo, microfiber hand-dry, extra paint care.',
      checklist: ['pH-neutral shampoo', 'Microfiber hand-dry'],
      durationMin: 15,
      prices: [
        ...car(249, 249, 249),
        { vehicleTypeId: 'scooter', price: 9900 },
        { vehicleTypeId: 'bike', price: 9900 },
        { vehicleTypeId: 'big', price: 9900 },
      ],
    },
    {
      id: 'bike-basic',
      name: 'Bike Basic Wash',
      popular: true,
      kind: 'wash',
      prices: [
        { vehicleTypeId: 'scooter', price: 14900 },
        { vehicleTypeId: 'bike', price: 14900 },
        { vehicleTypeId: 'big', price: 14900 },
      ],
    },
  ],
  plans: [
    { name: 'Express Plan', washes: 4, months: 1, popular: false, serviceName: 'Express Wash', prices: plan([1099, 1196], [1549, 1676]) },
    { name: 'Express Plan · 3 months', washes: 13, months: 3, popular: false, serviceName: 'Express Wash', prices: plan([3297, 3887], [4647, 5447]) },
    { name: 'Express Plan · 12 months', washes: 52, months: 13, popular: false, serviceName: 'Express Wash', prices: plan([13188, 15548], [18588, 21788]) },
    {
      name: 'Express + Premium Plan',
      washes: 4,
      months: 1,
      popular: false,
      serviceName: 'Express Wash',
      upgrade: { every: 4, name: 'Premium Wash' },
      prices: plan([1649, 1796], [2439, 2656]),
    },
    { name: 'Basic Plan', washes: 4, months: 1, popular: true, serviceName: 'Basic Wash', prices: plan([1849, 1996], [2949, 3196]) },
    { name: 'Basic Plan · 3 months', washes: 13, months: 3, popular: false, serviceName: 'Basic Wash', prices: plan([5547, 6487], [8847, 10387]) },
    {
      name: 'Shine Plan',
      washes: 4,
      months: 1,
      popular: false,
      serviceName: 'Basic Wash',
      upgrade: { every: 4, name: 'Premium Wash' },
      prices: plan([2199, 2396], [3499, 3796]),
    },
  ],
};
// Wednesday 28 Oct 2026, 6:30 pm in India.
const EVENING = new Date('2026-10-28T13:00:00Z');
const ctx: ChatContext = { businessName: 'Sri Mana Wash', branches: [hub], now: EVENING, bannerUrl: 'https://api.example/whatsapp/banner.jpg' };

const reply = (input: Parameters<typeof chatReply>[0], c = ctx) => chatReply(input, c);
const text = (t: string) => reply({ kind: 'text', text: t });
const choose = (id: string) => reply({ kind: 'choice', id });
/** Someone who last saw the list `context`, writing in `lang`. */
const after = (context: string, lang: ChatPerson['lang'] = null): ChatContext => ({
  ...ctx,
  person: { name: 'Ravi', returning: true, lang, context },
});
const only = (messages: ChatMessage[]) => {
  expect(messages).toHaveLength(1);
  return messages[0]!;
};
const bodyOf = (m: ChatMessage) => ('text' in m ? m.text : '');
const as = <T extends ChatMessage['type']>(m: ChatMessage | undefined, type: T) => {
  expect(m?.type).toBe(type);
  return m as Extract<ChatMessage, { type: T }>;
};

/** Every message must fit WhatsApp's limits, or Meta rejects it. */
function expectValid(messages: ChatMessage[]) {
  for (const m of messages) {
    if (m.type === 'buttons') {
      expect(m.buttons.length).toBeGreaterThan(0);
      expect(m.buttons.length).toBeLessThanOrEqual(WA_MAX_BUTTONS);
      expect(m.text.length).toBeLessThanOrEqual(1024);
      for (const b of m.buttons) {
        expect([...b.title].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
        expect(b.id.length).toBeLessThanOrEqual(WA_ID_MAX);
      }
      expect(new Set(m.buttons.map((b) => b.id)).size).toBe(m.buttons.length);
      expect([...(m.footer ?? '')].length).toBeLessThanOrEqual(WA_FOOTER_MAX);
    }
    if (m.type === 'link') {
      expect([...m.button].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
      expect(m.url).toMatch(/^https:\/\//);
      expect([...(m.footer ?? '')].length).toBeLessThanOrEqual(WA_FOOTER_MAX);
    }
    if (m.type === 'list') {
      expect(m.rows.length).toBeGreaterThan(0);
      expect(m.rows.length).toBeLessThanOrEqual(WA_MAX_LIST_ROWS);
      for (const r of m.rows) {
        expect([...r.title].length).toBeLessThanOrEqual(WA_ROW_TITLE_MAX);
        expect([...(r.description ?? '')].length).toBeLessThanOrEqual(WA_ROW_DESCRIPTION_MAX);
        expect(r.id.length).toBeLessThanOrEqual(WA_ID_MAX);
      }
      expect(new Set(m.rows.map((r) => r.id)).size).toBe(m.rows.length);
      expect([...m.button].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
      expect([...m.title].length).toBeLessThanOrEqual(WA_ROW_TITLE_MAX);
    }
  }
}

describe('WhatsApp assistant: the welcome', () => {
  it('has the banner, today’s hours, address, phone, the Telugu line and Car / Bike prices / Directions', () => {
    const m = as(only(text('Hi').messages), 'buttons');
    expectValid([m]);
    expect(m.imageUrl).toBe('https://api.example/whatsapp/banner.jpg');
    expect(m.text).toContain('Good evening! 👋');
    expect(m.text).toContain('Welcome to *Sri Mana Wash*, Kovur.');
    expect(m.text).toContain('Professional car and bike care.');
    expect(m.text).toContain('🕗 Open today: 7 am – 8 pm');
    expect(m.text).toContain('📍 Near Highway, Sai Baba Temple, Kovur');
    expect(m.text).toContain('📞 +91 91547 52999');
    expect(m.text.endsWith('How can we help you today?\n(తెలుగు కోసం "తెలుగు" అని టైప్ చేయండి)')).toBe(true);
    expect(m.footer).toBeUndefined();
    expect(m.buttons).toEqual([
      { id: 'cat|b1|car', title: '🚗 Car services' },
      { id: 'cat|b1|bike', title: '🏍️ Bike services' },
      { id: 'loc|b1', title: '📍 Get Directions' },
    ]);
  });

  it('greets by first name, and welcomes back someone we know', () => {
    const named = { ...ctx, person: { name: 'Ravi Kumar', returning: false, lang: null } };
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, named).messages[0]!)).toContain('Good evening, Ravi! 👋');
    const back = { ...ctx, person: { name: 'Ravi Kumar', returning: true, lang: null } };
    const body = bodyOf(reply({ kind: 'text', text: 'hi' }, back).messages[0]!);
    expect(body).toContain('Welcome back, Ravi! 👋');
    expect(body).toContain('Great to see you again at *Sri Mana Wash*, Kovur.');
  });

  it('says when it opens next after closing time and on the weekly off', () => {
    const late = { ...ctx, now: new Date('2026-10-28T15:00:00Z') }; // 8:30 pm
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, late).messages[0]!)).toContain('🌙 Closed for today · Opens tomorrow at 7 am');
    const offToday = { ...ctx, branches: [{ ...hub, hours: { ...hub.hours, weeklyOffDays: [3] } }] };
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, offToday).messages[0]!)).toContain('🔒 Closed today · Opens tomorrow at 7 am');
  });

  it('a branch with only cars offers Car prices, Directions and Talk to us', () => {
    const carsOnly = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.category === 'car') }] };
    const m = as(reply({ kind: 'text', text: 'hi' }, carsOnly).messages[0], 'buttons');
    expect(m.text).toContain('Professional car care.');
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'loc|b1', 'talk|b1']);
  });
});

describe('WhatsApp assistant: Telugu', () => {
  it('switches when they type “తెలుగు” or write in Telugu, and back with “English”', () => {
    const r = text('తెలుగు');
    expect(r.lang).toBe('te');
    expectValid(r.messages);
    const m = as(r.messages[0], 'buttons');
    expect(m.text).toContain('నమస్కారం! 👋');
    expect(m.text).toContain('🕗 ఈరోజు: ఉదయం 7 – రాత్రి 8');
    expect(m.text).toContain('(For English, type "English")');
    expect(m.buttons.map((b) => b.title)).toEqual(['🚗 కార్ సర్వీసులు', '🏍️ బైక్ సర్వీసులు', '📍 దారి చూపించు']);
    expect(text('telugu').lang).toBe('te');
    expect(text('నమస్కారం').lang).toBe('te');
    const inTelugu = { ...ctx, person: { name: 'Ravi', returning: true, lang: 'te' as const } };
    const again = reply({ kind: 'text', text: 'hi' }, inTelugu);
    expect(again.lang).toBeUndefined();
    expect(bodyOf(again.messages[0]!)).toContain('మళ్ళీ స్వాగతం, Ravi గారు! 👋');
    const english = reply({ kind: 'text', text: 'English' }, inTelugu);
    expect(english.lang).toBe('en');
    expect(english.forTeam).toBeUndefined();
    expect(bodyOf(english.messages[0]!)).toContain('Welcome back, Ravi! 👋');
    expect(text('తెలుగు').forTeam).toBeUndefined();
  });

  it('old language buttons still work', () => {
    expect(choose('lang|b1|te').lang).toBe('te');
    expect(reply({ kind: 'choice', id: 'lang|b1|en' }, after('', 'te')).lang).toBe('en');
  });

  it('keeps every Telugu message inside WhatsApp’s limits', () => {
    const tel = after('sz|b1|large', 'te');
    const choices = [
      'svc|b1', 'cat|b1|car', 'cat|b1|bike', 'find|b1|car', 'mk|b1|car|1', 'mo|b1|car|Maruti Suzuki|0',
      'sz|b1|small', 'sz|b1|mid', 'sz|b1|large', 'sz|b1|bike',
      'pr|b1|Maruti Suzuki|Brezza', 'pl|b1|sz|large', 'loc|b1', 'talk|b1', 'rate|b1',
    ];
    for (const choice of choices) expectValid(reply({ kind: 'choice', id: choice }, tel).messages);
    for (const n of ['1', '5', '6', '9']) expectValid(reply({ kind: 'text', text: n }, tel).messages);
    const large = bodyOf(reply({ kind: 'choice', id: 'sz|b1|large' }, tel).messages[0]!);
    expect(large).toContain('🚙 *SUV / 7-సీటర్*');
    expect(large).toContain('✨ *అదనంగా* (1, 2 లేదా 3 వాష్‌తో)\n5️⃣ Premium Care: *+₹249*');
    expect(large).toContain('📅 *నెల ప్లాన్‌లు* నెలకు *₹1,549* నుండి · 8% ఆదా');
  });
});

describe('WhatsApp assistant: Car prices / Bike prices', () => {
  it('Car prices lists the three sizes with well-known models, and Not sure?', () => {
    const m = as(only(choose('cat|b1|car').messages), 'list');
    expectValid([m]);
    expect(m.text).toBe('Which size is your car?\nPrices go by size: bigger cars take more time, water and care.');
    expect(m.button).toBe('Choose your size');
    expect(m.rows).toEqual([
      { id: 'sz|b1|small', title: '🚗 Hatchback', description: 'Swift, i20, Baleno, Kwid' },
      { id: 'sz|b1|mid', title: '🚘 Sedan / Compact SUV', description: 'Dzire, City, Nexon, Brezza' },
      { id: 'sz|b1|large', title: '🚙 SUV / 7-seater', description: 'Creta, XUV700, Innova, Fortuner' },
      { id: 'find|b1|car', title: '🤔 Not sure?', description: 'Find your model: pick the company, then the model' },
    ]);
  });

  it('Bike prices goes straight to the one bike price list, with Premium Care', () => {
    const r = choose('cat|b1|bike');
    const m = as(only(r.messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '🏍️ *Bike / Scooter*',
        'For Activa, Splendor, Pulsar, Royal Enfield, Harley…',
        'Prices at *Sri Mana Wash*, Kovur',
        '',
        '🧽 *Washes*',
        '_We use a high-lubricity, pH-neutral daily maintenance wash._',
        '1️⃣ Bike Basic Wash ⭐: *₹149*',
        '',
        '✨ *Add-on* (with wash 1)',
        '2️⃣ Premium Care: *+₹99*',
        '_Gentle shampoo, microfiber hand-dry, extra paint care_',
        '',
        "👉 Reply a number to see what's included",
      ].join('\n'),
    );
    // No other bike size: the other button is Car prices.
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'loc|b1', 'talk|b1']);
    expect(r.context).toBe('sz|b1|bike');
    // Links from older messages still work.
    expect(choose('sz|b1|bigBike').context).toBe('sz|b1|bike');
  });

  it('only lists the sizes the branch prices', () => {
    const noLarge = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.id !== 'suv') }] };
    const rows = as(only(reply({ kind: 'choice', id: 'cat|b1|car' }, noLarge).messages), 'list').rows;
    expect(rows.map((r) => r.id)).toEqual(['sz|b1|small', 'sz|b1|mid', 'find|b1|car']);
  });

  it('the reminder’s See prices button asks Car or Bike, or goes straight to the sizes', () => {
    const m = as(only(choose('svc|b1').messages), 'buttons');
    expect(m.text).toBe('Which prices would you like to see?');
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike']);
    const carsOnly = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.category === 'car') }] };
    expect(as(only(reply({ kind: 'choice', id: 'svc|b1' }, carsOnly).messages), 'list').rows[0]!.id).toBe('sz|b1|small');
  });

  it('says the price list is coming when nothing is priced yet', () => {
    const empty = { ...ctx, branches: [{ ...hub, services: [] }] };
    const m = as(only(reply({ kind: 'choice', id: 'svc|b1' }, empty).messages), 'buttons');
    expect(m.text).toContain('updating our price list');
    expectValid([m]);
  });

  it('a branch whose vehicle types fit no size goes straight to the companies', () => {
    const custom = {
      ...ctx,
      branches: [{ ...hub, vehicleTypes: [{ id: 'hatch', name: 'Hatchback', category: 'car' as const, bodyKey: null }], services: hub.services.slice(0, 1) }],
    };
    // "Hatchback" reads as a hatchback, so it still has its size (the only one: straight to it).
    expect(reply({ kind: 'choice', id: 'cat|b1|car' }, custom).context).toBe('sz|b1|small');
    const vans = { ...ctx, branches: [{ ...hub, vehicleTypes: [{ id: 'hatch', name: 'Van', category: 'car' as const, bodyKey: 'van' }], services: hub.services.slice(0, 1) }] };
    expect(as(only(reply({ kind: 'choice', id: 'cat|b1|car' }, vans).messages), 'list').title).toBe('Companies');
  });
});

describe('WhatsApp assistant: a size’s prices', () => {
  it('shows the washes, the add-on and monthly plans, numbered, with PLANS for longer plans', () => {
    const r = choose('sz|b1|large');
    const m = as(only(r.messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '🚙 *SUV / 7-seater*',
        'For Creta, XUV700, Innova, Fortuner, BMW X5…',
        'Prices at *Sri Mana Wash*, Kovur',
        '',
        '🧽 *Washes*',
        '_We use a high-lubricity, pH-neutral daily maintenance wash._',
        '1️⃣ Express Wash: *₹419*',
        '2️⃣ Basic Wash ⭐: *₹799*',
        '3️⃣ Premium Wash: *₹1,399*',
        '',
        '🛡️ *Care & protection*',
        '4️⃣ Anti-Rust Protection: *₹4,500*',
        '',
        '✨ *Add-on* (with wash 1, 2 or 3)',
        '5️⃣ Premium Care: *+₹249*',
        '_Gentle shampoo, microfiber hand-dry, extra paint care_',
        '',
        '📅 *Monthly plans* from *₹1,549* a month · save 8%',
        'Pick a plan, or build your own: tap *📅 Monthly plans*',
        '',
        "👉 Reply a number to see what's included",
      ].join('\n'),
    );
    expect(m.buttons).toEqual([
      { id: 'pl|b1|sz|large', title: '📅 Monthly plans' },
      { id: 'cat|b1|car', title: '🔁 Other size' },
      { id: 'talk|b1', title: '📞 Talk to us' },
    ]);
    // Remembered, so a number or PLANS reads from it.
    expect(r.context).toBe('sz|b1|large');
  });

  it('a mid-size car is priced from the sedan, and bikes by type', () => {
    const mid = bodyOf(only(choose('sz|b1|mid').messages));
    expect(mid).toContain('🚘 *Sedan / Compact SUV*\nFor Dzire, City, Nexon, Brezza, BMW 3 Series…');
    expect(mid).toContain('1️⃣ Express Wash: *₹349*');
    const harley = as(only(choose('pr|b1|Harley-Davidson|Fat Boy').messages), 'buttons');
    expect(harley.text).toContain('🏍️ *Harley-Davidson Fat Boy*\nBike prices at *Sri Mana Wash*, Kovur');
    expect(harley.text).toContain('1️⃣ Bike Basic Wash ⭐: *₹149*');
    expect(harley.text).not.toContain('Monthly plans');
  });

  it('a size the branch no longer prices goes back to the start of prices', () => {
    const noLarge = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.id !== 'suv') }] };
    expect(as(only(reply({ kind: 'choice', id: 'sz|b1|large' }, noLarge).messages), 'buttons').text).toBe('Which prices would you like to see?');
  });
});

/** The hub as it opens: Anti-Rust and Premium Care are listed, but coming soon (not sold yet). */
const soonHub: ChatBranch = {
  ...hub,
  services: hub.services.map((s) =>
    s.id === 'rust'
      ? { ...s, description: 'Underbody wash and anti-rust coating.', comingSoon: true }
      : s.id === 'care'
        ? { ...s, description: 'Our thick yellow snow foam and a wash-and-wax lather for a deep, glossy shine that protects the paint.', comingSoon: true }
        : s,
  ),
};
const soonCtx: ChatContext = { ...ctx, branches: [soonHub] };

describe('WhatsApp assistant: coming soon', () => {
  it('keeps them in their place and number, marked coming soon', () => {
    const m = as(only(reply({ kind: 'choice', id: 'sz|b1|large' }, soonCtx).messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '🚙 *SUV / 7-seater*',
        'For Creta, XUV700, Innova, Fortuner, BMW X5…',
        'Prices at *Sri Mana Wash*, Kovur',
        '',
        '🧽 *Washes*',
        '_We use a high-lubricity, pH-neutral daily maintenance wash._',
        '1️⃣ Express Wash: *₹419*',
        '2️⃣ Basic Wash ⭐: *₹799*',
        '3️⃣ Premium Wash: *₹1,399*',
        '',
        '🛡️ *Care & protection*',
        '4️⃣ Anti-Rust Protection: *₹4,500* (🔜 Coming soon)',
        '',
        '✨ *Add-on* (with wash 1, 2 or 3)',
        '5️⃣ Premium Care: *+₹249* (🔜 Coming soon)',
        '_Our thick yellow snow foam and a wash-and-wax lather for a deep, glossy shine that protects the paint_',
        '',
        '📅 *Monthly plans* from *₹1,549* a month · save 8%',
        'Pick a plan, or build your own: tap *📅 Monthly plans*',
        '',
        "👉 Reply a number to see what's included",
      ].join('\n'),
    );
    expect(bodyOf(only(reply({ kind: 'choice', id: 'cat|b1|bike' }, soonCtx).messages))).toContain('2️⃣ Premium Care: *+₹99* (🔜 Coming soon)');
    const te = reply({ kind: 'choice', id: 'sz|b1|large' }, { ...soonCtx, person: { name: null, returning: false, lang: 'te' } }).messages;
    expectValid(te);
    expect(bodyOf(te[0]!)).toContain('5️⃣ Premium Care: *+₹249* (🔜 త్వరలో)');
  });

  it('its number says what it is and that it isn’t available yet', () => {
    const seen = { ...soonCtx, person: { name: 'Ravi', returning: true, lang: null, context: 'sz|b1|large' } };
    const m = as(only(reply({ kind: 'text', text: '5' }, seen).messages), 'buttons');
    expectValid([m]);
    expect(m.text.startsWith('5️⃣ *Premium Care*\n🚙 SUV / 7-seater · *+₹249* (🔜 Coming soon)\n\nOur thick yellow snow foam and a wash-and-wax lather for a deep, glossy shine that protects the paint.')).toBe(true);
    expect(m.text.endsWith("🔜 *Coming soon.* It isn't available yet: ask us at the counter, and we'll tell you when it starts.")).toBe(true);
    expect(m.text).not.toContain('Add it to');
  });

  it('a branch that only has coming-soon services for a vehicle has no prices for it', () => {
    const onlySoon = { ...ctx, branches: [{ ...soonHub, services: soonHub.services.filter((s) => s.comingSoon) }] };
    expect(as(only(reply({ kind: 'choice', id: 'svc|b1' }, onlySoon).messages), 'buttons').text).toContain('updating our price list');
  });

  it('asking about it by name says it’s coming, not a question for the team', () => {
    const r = reply({ kind: 'text', text: 'Do you have premium care?' }, soonCtx);
    expect(r.forTeam).toBeUndefined();
    const m = as(only(r.messages), 'buttons');
    expect(m.text).toBe(
      [
        '🔜 *Premium Care* is coming soon at *Sri Mana Wash*, Kovur.',
        '',
        'Our thick yellow snow foam and a wash-and-wax lather for a deep, glossy shine that protects the paint.',
        '',
        "It isn't available yet. Ask us at the counter, and we'll tell you when it starts.",
      ].join('\n'),
    );
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike', 'loc|b1']);
  });

  it('Deep Interior Cleaning: listed under care, after the washes, with its time in hours', () => {
    const deep = {
      id: 'deep',
      name: 'Deep Interior Cleaning',
      popular: false,
      kind: 'protection' as const,
      comingSoon: true,
      durationMin: 240,
      description: 'Every surface inside, deep cleaned: seats shampooed or leather conditioned, carpets, roof and AC vents. Express Wash free.',
      checklist: ['Fabric seats shampooed & extracted', 'AC vents cleaned', 'Express Wash free'],
      prices: car(2499, 2999, 3499),
    };
    // Listed first in the catalog, it still comes after the washes (care keeps the catalog's order).
    const withDeep: ChatContext = { ...soonCtx, branches: [{ ...soonHub, services: [deep, ...soonHub.services] }] };
    const list = bodyOf(only(reply({ kind: 'choice', id: 'sz|b1|large' }, withDeep).messages));
    expect(list).toContain(
      ['3️⃣ Premium Wash: *₹1,399*', '', '🛡️ *Care & protection*', '4️⃣ Deep Interior Cleaning: *₹3,499* (🔜 Coming soon)', '5️⃣ Anti-Rust Protection: *₹4,500* (🔜 Coming soon)', '', '✨ *Add-on* (with wash 1, 2 or 3)', '6️⃣ Premium Care: *+₹249* (🔜 Coming soon)'].join('\n'),
    );
    expect(bodyOf(only(reply({ kind: 'choice', id: 'cat|b1|bike' }, withDeep).messages))).not.toContain('Deep Interior');
    const seen = { ...withDeep, person: { name: 'Ravi', returning: true, lang: null, context: 'sz|b1|small' } };
    const four = as(only(reply({ kind: 'text', text: '4' }, seen).messages), 'buttons');
    expectValid([four]);
    expect(four.text).toContain('4️⃣ *Deep Interior Cleaning*\n🚗 Hatchback · *₹2,499* (🔜 Coming soon)');
    expect(four.text).toContain('• Express Wash free');
    expect(four.text).toContain('⏱️ Takes about 4 hours');
    expect(four.text).not.toContain('pH-neutral');
    const halfway = { ...withDeep, branches: [{ ...soonHub, services: [{ ...deep, durationMin: 210 }, ...soonHub.services] }] };
    expect(bodyOf(only(reply({ kind: 'text', text: '4' }, { ...halfway, person: seen.person }).messages))).toContain('⏱️ Takes about 3½ hours');
    // Asked about by its short name, it's coming soon; "premium" alone is still the Premium Wash.
    for (const text of ['Do you do deep interior cleaning?', 'deep interior?']) {
      expect(bodyOf(only(reply({ kind: 'text', text }, withDeep).messages))).toContain('🔜 *Deep Interior Cleaning* is coming soon');
    }
    expect(reply({ kind: 'text', text: 'anti rust?' }, withDeep).messages.map(bodyOf).join()).toContain('🔜 *Anti-Rust Protection* is coming soon');
    expect(reply({ kind: 'text', text: 'what is in premium?' }, withDeep).messages.map(bodyOf).join()).not.toContain('Premium Care* is coming soon');
  });

  it('the Flow marks it too', () => {
    const md = chatFlowReply(
      { action: 'data_exchange', screen: 'MODEL', data: { step: 'model', company: 'Maruti Suzuki', model: 'Swift' }, flow_token: chatFlowToken('b1', 'car', 'en') },
      soonCtx,
    ).data.prices as string;
    expect(md).toContain('## 🛡️ Care & protection\n4. **Anti-Rust Protection** — ₹4,500 (🔜 Coming soon)');
    expect(md).toContain('5. **Premium Care** — +₹249 (🔜 Coming soon) · Our thick yellow snow foam');
  });
});

describe('WhatsApp assistant: numbers and PLANS', () => {
  it('a number shows what that wash includes, with a way back to the size’s prices', () => {
    const m = as(only(reply({ kind: 'text', text: '1' }, after('sz|b1|large')).messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '1️⃣ *Express Wash*',
        '🚙 SUV / 7-seater · *₹419*',
        '',
        'A quick, careful outside wash.',
        '',
        '🧴 We use a high-lubricity, pH-neutral daily maintenance wash.',
        '',
        "✅ *What's included*",
        '• Snow foam',
        '• Two-bucket hand wash',
        '• Tyre shine',
        '',
        '⏱️ Takes about 25 minutes',
      ].join('\n'),
    );
    expect(m.buttons).toEqual([
      { id: 'sz|b1|large', title: '📋 Back to prices' },
      { id: 'loc|b1', title: '📍 Get Directions' },
      { id: 'talk|b1', title: '📞 Talk to us' },
    ]);
  });

  it('the add-on explains itself', () => {
    const care = bodyOf(only(reply({ kind: 'text', text: '5' }, after('sz|b1|small')).messages));
    expect(care).toContain('5️⃣ *Premium Care*\n🚗 Hatchback · *+₹249*');
    expect(care).toContain('• pH-neutral shampoo');
    expect(care).toContain('⏱️ Adds about 15 minutes');
    expect(care).toContain('Add it to an Express Wash, Basic Wash or Premium Wash at the counter.');
  });

  it('a number past the end asks for one in range; without a list it’s a hello', () => {
    expect(bodyOf(only(reply({ kind: 'text', text: '9' }, after('sz|b1|large')).messages))).toBe('Please pick a number from *1* to *5*. 🙏');
    expect(as(only(text('2').messages), 'buttons').imageUrl).toBeDefined();
  });

  it('PLANS lists the plans by name, what is in each underneath, and Build your own', () => {
    const r = reply({ kind: 'text', text: 'PLANS' }, after('sz|b1|small'));
    const m = as(only(r.messages), 'list');
    expectValid([m]);
    expect(m.text).toBe(
      ['📅 *Monthly plans* · 🚗 Hatchback', '4 washes a month, on any days you like. Pay once and save 8%.', '', 'Pick a plan, or build your own 👇'].join('\n'),
    );
    expect(m.button).toBe('Choose a plan');
    expect(m.rows).toEqual([
      { id: 'pp|b1|Express Plan|sz|small', title: 'Express Plan', description: '4 Express · ₹1,099 a month' },
      { id: 'pp|b1|Express + Premium Plan|sz|small', title: 'Express + Premium Plan', description: '3 Express + 1 Premium · ₹1,649 a month' },
      { id: 'pp|b1|Basic Plan|sz|small', title: 'Basic Plan ⭐', description: '4 Basic · ₹1,849 a month' },
      { id: 'pp|b1|Shine Plan|sz|small', title: 'Shine Plan', description: '3 Basic + 1 Premium · ₹2,199 a month' },
      { id: 'bo|b1|-|sz|small', title: '🛠️ Build your own', description: 'Pick any 4 washes · save 8%' },
    ]);
    // The price list stays remembered: a number still picks from it.
    expect(r.context).toBeUndefined();
    for (const word of ['plans', 'Plan', 'monthly plans', 'ప్లాన్‌లు']) {
      expect(as(reply({ kind: 'text', text: word }, after('sz|b1|small')).messages[0], 'list').rows).toHaveLength(5);
    }
    // A button from an older message (the everyday wash) shows the same list.
    expect(as(only(choose('pm|b1|Express Wash|sz|small').messages), 'list').rows).toHaveLength(5);
  });

  it('a ready plan: its name, what is in it, and its price for each length', () => {
    const m = as(only(choose('pp|b1|Express + Premium Plan|sz|small').messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '✨ *Express + Premium Plan* · 🚗 Hatchback',
        '*3 Express + 1 Premium* a month, in any order, on any days you like.',
        '',
        '• 1 month: *₹1,649* (save ₹147)',
        '',
        "💡 That's *₹412* a wash.",
        '⬆️ Want a better wash on the day? Pay just the difference.',
        '🗓️ 7 extra days to use any wash left, and 1 unused wash carries over when you renew.',
        '',
        'Ask for *Express + Premium Plan* at the counter on your next visit.',
      ].join('\n'),
    );
    expect(m.buttons).toEqual([
      { id: 'pl|b1|sz|small', title: '🔁 Other plans' },
      { id: 'sz|b1|small', title: '📋 Back to prices' },
      { id: 'talk|b1', title: '📞 Talk to us' },
    ]);
    const longer = bodyOf(only(choose('pp|b1|Express Plan|sz|small').messages));
    expect(longer).toContain('• 1 month: *₹1,099* (save ₹97)');
    expect(longer).toContain('• 3 months: *₹3,297* (save ₹590) · 13 washes, 1 free ⭐ *Best value*');
    expect(longer).toContain('• 12 months: *₹13,188* (save ₹2,360) · 13 months for 12');
    const te = reply({ kind: 'choice', id: 'pp|b1|Express + Premium Plan|sz|small' }, after('', 'te')).messages;
    expectValid(te);
    expect(bodyOf(te[0]!)).toContain('నెలకు *3 Express + 1 Premium*');
  });

  it('Build your own: one wash a tap, 4 taps, then the price', () => {
    const first = as(only(choose('bo|b1|-|sz|large').messages), 'buttons');
    expectValid([first]);
    expect(first.text).toBe(
      ['🛠️ *Build your plan* · 🚙 SUV / 7-seater', 'Pick 4 washes for your month. Use them on any days you like.', '', '*Wash 1 of 4:*'].join('\n'),
    );
    expect(first.buttons).toEqual([
      { id: 'bo|b1|0|sz|large', title: 'Express Wash · ₹419'.replace(' Wash', '') },
      { id: 'bo|b1|1|sz|large', title: 'Basic · ₹799' },
      { id: 'bo|b1|2|sz|large', title: 'Premium · ₹1,399' },
    ]);
    const third = as(only(choose('bo|b1|10|sz|large').messages), 'buttons');
    expect(third.text).toBe('✅ Basic, Express\n\n*Wash 3 of 4:*');
    expect(third.buttons[2]!.id).toBe('bo|b1|102|sz|large');
    // The 4th tap: 2 Express + 1 Basic + 1 Premium, priced like the counter (the 4 added up, less 8%).
    const done = as(only(choose('bo|b1|1002|sz|large').messages), 'buttons');
    expectValid([done]);
    expect(done.text).toBe(
      [
        '✨ *Your plan* · 🚙 SUV / 7-seater',
        '*2 Express + 1 Basic + 1 Premium* a month, in any order',
        '',
        '• 1 month: *₹2,789* (save ₹247)',
        '• 3 months: *₹8,367* (save ₹1,160) · 13 washes, 1 free ⭐ *Best value*',
        '• 12 months: *₹33,468* (save ₹6,000) · 13 months for 12',
        '',
        "💡 That's *₹697* a wash.",
        '⬆️ Want a better wash on the day? Pay just the difference.',
        '🗓️ 7 extra days to use any wash left, and 1 unused wash carries over when you renew.',
        '',
        'Show this message at the counter to buy it.',
      ].join('\n'),
    );
    expect(done.buttons.map((b) => b.id)).toEqual(['bo|b1|-|sz|large', 'sz|b1|large', 'talk|b1']);
    // Telugu fits too; a pick from an older list starts again.
    expectValid(reply({ kind: 'choice', id: 'bo|b1|1002|sz|large' }, after('', 'te')).messages);
    expect(bodyOf(only(choose('bo|b1|09|sz|large').messages))).toContain('*Wash 1 of 4:*');
  });

  it('a number after an older plans list reads from the price list', () => {
    expect(bodyOf(only(reply({ kind: 'text', text: '1' }, after('pl|b1|sz|small')).messages))).toContain('1️⃣ *Express Wash*');
  });

  it('PLANS before any price list asks for the vehicle first', () => {
    const out = text('plans').messages;
    expect(bodyOf(out[0]!)).toBe("Pick your vehicle first and we'll show its plans. 👇");
    expect(as(out[1], 'buttons').buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike']);
  });

  it('a size with no plans says so', () => {
    expect(bodyOf(only(choose('pl|b1|sz|bike').messages))).toBe("We don't have wash plans for the *Bike / Scooter* yet. 🙏");
  });
});

describe('WhatsApp assistant: finding a model', () => {
  it('Not sure? walks company → model → “Brezza is a Sedan / Compact SUV” with mid-size prices', () => {
    const makes = as(only(choose('find|b1|car').messages), 'list');
    expectValid([makes]);
    expect(makes.rows[0]!.title).toBe('Maruti Suzuki');
    // Tractors and buses aren't on a branch that only washes cars.
    expect(makes.rows.some((r) => r.title === 'Mahindra Construction')).toBe(false);

    const models = as(only(choose(makes.rows[0]!.id).messages), 'list');
    expectValid([models]);
    expect(models.rows.every((r) => r.id.startsWith('pr|b1|Maruti Suzuki|') || r.id.startsWith('mo|b1|car|Maruti Suzuki|'))).toBe(true);
    expect(models.rows.filter((r) => r.id.startsWith('pr|')).every((r) => ['Hatchback', 'Sedan / Compact SUV', 'SUV / 7-seater'].includes(r.description!))).toBe(true);

    const r = choose('pr|b1|Maruti Suzuki|Brezza');
    const m = as(only(r.messages), 'buttons');
    expectValid([m]);
    expect(m.text.startsWith('🚘 *Maruti Suzuki Brezza* is a *Sedan / Compact SUV*.\nSedan / Compact SUV prices at *Sri Mana Wash*, Kovur\n\n🧽 *Washes*\n_We use a high-lubricity, pH-neutral daily maintenance wash._\n1️⃣ Express Wash: *₹349*')).toBe(true);
    expect(m.buttons[0]).toEqual({ id: 'cat|b1|car', title: '🔁 Other size' });
    expect(r.context).toBe('pr|b1|Maruti Suzuki|Brezza');
    // A number after it reads from the same list.
    const detail = as(only(reply({ kind: 'text', text: '5' }, after('pr|b1|Maruti Suzuki|Brezza')).messages), 'buttons');
    expect(detail.text).toContain('5️⃣ *Premium Care*\n🚘 Maruti Suzuki Brezza · *+₹249*');
    expect(detail.buttons[0]).toEqual({ id: 'pr|b1|Maruti Suzuki|Brezza', title: '📋 Back to prices' });
  });

  it('pages long company lists with a More row', () => {
    const makes = as(only(choose('find|b1|car').messages), 'list');
    const more = makes.rows.at(-1)!;
    expect(more.title).toBe('More companies ›');
    const next = as(only(choose(more.id).messages), 'list');
    expectValid([next]);
    expect(next.rows.map((r) => r.title)).not.toContain('Maruti Suzuki');
  });

  it('a typed model jumps to its size and prices, imported brands by their size', () => {
    expect(bodyOf(only(text('swift').messages))).toContain('🚗 *Maruti Suzuki Swift* is a *Hatchback*.\nHatchback prices at');
    expect(text('swift').context).toBe('pr|b1|Maruti Suzuki|Swift');
    expect(bodyOf(only(text('Activa').messages))).toContain('🏍️ *Honda Activa*\nBike prices at');
    expect(bodyOf(only(text('my car is a creta').messages))).toContain('🚙 *Hyundai Creta* is an *SUV / 7-seater*.');
    const x5 = bodyOf(only(text('BMW X5').messages));
    expect(x5).toContain('🚙 *BMW X5* is an *SUV / 7-seater*.\nSUV / 7-seater prices at');
    expect(x5).toContain('1️⃣ Express Wash: *₹419*');
    expect(bodyOf(only(choose('pr|b1|BMW|3 Series').messages))).toContain('🚘 *BMW 3 Series* is a *Sedan / Compact SUV*.');
    expect(bodyOf(only(choose('pr|b1|Royal Enfield|Classic 350').messages))).toContain('Bike prices at');
  });

  it('asks which one when a name fits several models', () => {
    const rows = vehicleGuideRows();
    expect(findModels('swift dzire', rows).every((r) => r.model.toLowerCase().includes('dzire'))).toBe(true);
    expectValid(text('City').messages);
  });

  it('says sorry for a model the branch has no price for', () => {
    // A lorry, on a branch that washes cars and bikes only.
    const m = as(only(choose('pr|b1|Tata|Prima 4028').messages), 'buttons');
    expect(m.text).toContain("Sorry, we don't have prices for the *Tata Prima 4028*");
    expectValid([m]);
  });
});

describe('WhatsApp assistant: everything else', () => {
  it('greetings get the welcome; a real question goes to the team', () => {
    for (const hi of ['Hi', 'hii', 'Hello!', 'good morning', 'menu', 'prices', '👋']) {
      const r = text(hi);
      expect(r.forTeam).toBeUndefined();
      expect(as(r.messages[0], 'buttons').imageUrl).toBeDefined();
    }
    const q = text('Do you wash tractors?');
    expect(q.forTeam).toBe(true);
    const ack = as(only(q.messages), 'buttons');
    expect(ack.text).toContain('Our team will reply here shortly');
    expect(ack.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike', 'loc|b1']);
  });

  it('photos and voice notes go to the team', () => {
    const r = reply({ kind: 'media' });
    expect(r.forTeam).toBe(true);
    expect(bodyOf(only(r.messages))).toContain('Our team will reply');
  });

  it('stays quiet while a teammate is talking with them, but still answers buttons', () => {
    const paused = { ...ctx, person: { name: 'Ravi', returning: true, lang: null, paused: true } };
    expect(reply({ kind: 'text', text: 'ok I will come at 5' }, paused)).toEqual({ messages: [], forTeam: true });
    expect(reply({ kind: 'media' }, paused).messages).toHaveLength(0);
    expect(reply({ kind: 'choice', id: 'loc|b1' }, paused).messages.length).toBeGreaterThan(0);
  });

  it('the Stop offers button turns offers off', () => {
    expect(choose('STOP').marketing).toBe('stop');
    expect(choose('START').marketing).toBe('start');
  });

  it('sends the pin and a Google Maps directions button', () => {
    const out = choose('loc|b1').messages;
    expectValid(out);
    expect(out[0]).toMatchObject({ type: 'location', latitude: 14.49, longitude: 79.98 });
    const card = as(out[1], 'link');
    expect(card.url).toBe('https://www.google.com/maps/dir/?api=1&destination=14.49,79.98');
    expect(card.button).toBe('Open in Google Maps');
    expect(card.text).toContain('🕗 Open today: 7 am – 8 pm');
    expect(card.text).toContain('+91 91547 52999');
  });

  it('searches Google Maps by name and address when there is no pin', () => {
    const noPin = { ...ctx, branches: [{ ...hub, location: null }] };
    const out = reply({ kind: 'choice', id: 'loc|b1' }, noPin).messages;
    expect(as(only(out), 'link').url).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Sri Mana Wash, Near Highway, Sai Baba Temple, Kovur')}`,
    );
  });

  it('gives the number to call', () => {
    const body = bodyOf(only(choose('talk|b1').messages));
    expect(body).toContain('📞 *Call us:* +91 91547 52999');
    expect(body).toContain('📍 Or visit us: Near Highway, Sai Baba Temple, Kovur');
  });

  it('answers the bill’s Rate us button with a review button', () => {
    const m = as(only(choose(rateChoiceId('b1')).messages), 'link');
    expect(m.url).toBe('https://g.page/r/abc/review');
  });

  it('handles STOP and START', () => {
    expect(text('STOP').marketing).toBe('stop');
    expect(text('start').marketing).toBe('start');
    expect(text('Hi').marketing).toBeUndefined();
  });

  it('says thanks back without the whole menu', () => {
    expect(bodyOf(only(text('Thank you 🙏').messages))).toContain("You're welcome");
    expect(bodyOf(only(text('ధన్యవాదాలు').messages))).toContain('సంతోషం');
  });

  it('asks for the branch first when there are several', () => {
    const two = { ...ctx, branches: [hub, { ...hub, id: 'b2', name: 'Nellore', city: 'Nellore' }] };
    const m = as(only(reply({ kind: 'text', text: 'hi' }, two).messages), 'list');
    expectValid([m]);
    expect(m.rows.map((r) => r.id)).toEqual(['br|b1', 'br|b2']);
    const next = as(reply({ kind: 'choice', id: 'br|b2' }, two).messages[0], 'buttons');
    expect(next.buttons[0]!.id).toBe('cat|b2|car');
  });
});

describe('WhatsApp assistant: the Services & Prices Flow', () => {
  it('with the Flow published, Not sure? opens it; Car prices still lists the sizes', () => {
    const withFlow = { ...ctx, flows: true };
    expect(as(only(reply({ kind: 'choice', id: 'cat|b1|car' }, withFlow).messages), 'list').rows[0]!.id).toBe('sz|b1|small');
    const m = as(only(reply({ kind: 'choice', id: 'find|b1|car' }, withFlow).messages), 'flow');
    expect(m.token).toBe('flow|b1|car|en');
    expect(m.button).toBe('Choose your car');
    expect([...m.button].length).toBeLessThanOrEqual(30);
  });

  it('walks companies (with logos) → models → prices, numbered like the chat', () => {
    const token = chatFlowToken('b1', 'car', 'en');
    expect(chatFlowReply({ action: 'ping' }, ctx)).toEqual({ data: { status: 'active' } });
    const open = chatFlowReply({ action: 'INIT', flow_token: token }, ctx, { 'Maruti Suzuki': 'BASE64' });
    expect(open.screen).toBe('COMPANY');
    const companies = open.data.companies as { id: string; title: string; image?: string }[];
    expect(companies[0]).toEqual({ id: 'Maruti Suzuki', title: 'Maruti Suzuki', image: 'BASE64', 'alt-text': 'Maruti Suzuki logo' });
    expect(companies.some((c) => c.id === 'Honda' && !c.image)).toBe(true);
    const models = chatFlowReply({ action: 'data_exchange', screen: 'COMPANY', data: { step: 'company', company: 'Maruti Suzuki' }, flow_token: token }, ctx);
    expect(models.screen).toBe('MODEL');
    expect((models.data.models as { id: string; description: string }[]).find((r) => r.id === 'Swift')?.description).toBe('Hatchback');
    const prices = chatFlowReply({ action: 'data_exchange', screen: 'MODEL', data: { step: 'model', company: 'Maruti Suzuki', model: 'Swift' }, flow_token: token }, ctx);
    expect(prices.screen).toBe('PRICES');
    const md = prices.data.prices as string;
    expect(md).toContain('# 🚗 Maruti Suzuki Swift\nHatchback · Sri Mana Wash, Kovur');
    expect(md).toContain('2. **Basic Wash** ⭐ — ₹499');
    expect(md).toContain('5. **Premium Care** — +₹249 · Gentle shampoo, microfiber hand-dry, extra paint care');
    expect(md).toContain('📅 **Monthly plans** from **₹1,099** a month · save 8%');
    const telugu = chatFlowReply({ action: 'INIT', flow_token: chatFlowToken('b1', 'bike', 'te') }, ctx);
    expect(telugu.data.heading).toBe('మీ బైక్ ఏ కంపెనీది?');
  });

  it('finishing the Flow sends that model’s price list in the chat', () => {
    const choice = chatFlowChoice(JSON.stringify({ company: 'Maruti Suzuki', model: 'Swift', flow_token: 'flow|b1|car|en' }));
    expect(choice).toBe('pr|b1|Maruti Suzuki|Swift');
    expect(bodyOf(only(choose(choice!).messages))).toContain('1️⃣ Express Wash');
    expect(chatFlowChoice('not json')).toBeNull();
  });

  it('the Flow layout has a screen for every step of the routing', () => {
    const ids = WA_FLOW_JSON.screens.map((sc) => sc.id);
    expect(Object.keys(WA_FLOW_JSON.routing_model)).toEqual(ids);
    expect(JSON.stringify(WA_FLOW_JSON).length).toBeLessThan(10_000_000);
  });
});
