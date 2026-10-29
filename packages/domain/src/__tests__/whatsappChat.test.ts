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
      prices: car(249, 249, 249),
    },
    {
      id: 'bike-basic',
      name: 'Bike Basic Wash',
      popular: true,
      kind: 'wash',
      prices: [
        { vehicleTypeId: 'scooter', price: 14900 },
        { vehicleTypeId: 'bike', price: 14900 },
        { vehicleTypeId: 'big', price: 29900 },
      ],
    },
  ],
  plans: [
    { name: 'Express Plan', washes: 4, months: 1, popular: false, serviceName: 'Express Wash', prices: plan([1099, 1196], [1549, 1676]) },
    { name: 'Express Plan · 3 months', washes: 13, months: 3, popular: false, serviceName: 'Express Wash', prices: plan([3297, 3887], [4647, 5447]) },
    { name: 'Express Plan · 12 months', washes: 52, months: 13, popular: false, serviceName: 'Express Wash', prices: plan([13188, 15548], [18588, 21788]) },
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
      { id: 'cat|b1|car', title: '🚗 Car prices' },
      { id: 'cat|b1|bike', title: '🏍️ Bike prices' },
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
    expect(m.buttons.map((b) => b.title)).toEqual(['🚗 కార్ ధరలు', '🏍️ బైక్ ధరలు', '📍 దారి చూపించు']);
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
      'sz|b1|small', 'sz|b1|mid', 'sz|b1|large', 'sz|b1|scooter', 'sz|b1|bike', 'sz|b1|bigBike',
      'pr|b1|Maruti Suzuki|Brezza', 'pl|b1|sz|large', 'loc|b1', 'talk|b1', 'rate|b1',
    ];
    for (const choice of choices) expectValid(reply({ kind: 'choice', id: choice }, tel).messages);
    for (const n of ['1', '5', '6', '9']) expectValid(reply({ kind: 'text', text: n }, tel).messages);
    const large = bodyOf(reply({ kind: 'choice', id: 'sz|b1|large' }, tel).messages[0]!);
    expect(large).toContain('🚙 *పెద్ద కార్ / 7-సీటర్*');
    expect(large).toContain('5️⃣ Premium Care: *+₹249*');
    expect(large).toContain('6️⃣ Express Plan: *₹1,549* (₹127 ఆదా)');
    expect(large).toContain('💡 3 & 12 నెలల ప్లాన్‌లతో ఇంకా ఆదా: *PLANS* అని పంపండి');
  });
});

describe('WhatsApp assistant: Car prices / Bike prices', () => {
  it('Car prices lists the three sizes with well-known models, and Not sure?', () => {
    const m = as(only(choose('cat|b1|car').messages), 'list');
    expectValid([m]);
    expect(m.text).toBe('Which size is your car?\nPrices go by size: bigger cars take more time, water and care.');
    expect(m.button).toBe('Choose size');
    expect(m.rows).toEqual([
      { id: 'sz|b1|small', title: '🚗 Small car', description: 'Swift, i20, Baleno, Kwid' },
      { id: 'sz|b1|mid', title: '🚘 Mid-size car', description: 'Dzire, City, Nexon, Brezza' },
      { id: 'sz|b1|large', title: '🚙 Large / 7-seater', description: 'Creta, XUV700, Innova, Fortuner' },
      { id: 'find|b1|car', title: '🤔 Not sure?', description: 'Find your model: pick the company, then the model' },
    ]);
  });

  it('Bike prices lists scooter, bike and big bike', () => {
    const m = as(only(choose('cat|b1|bike').messages), 'list');
    expectValid([m]);
    expect(m.text).toBe('Which type is your bike?');
    expect(m.rows.map((r) => r.id)).toEqual(['sz|b1|scooter', 'sz|b1|bike', 'sz|b1|bigBike', 'find|b1|bike']);
    expect(m.rows[2]).toEqual({ id: 'sz|b1|bigBike', title: '🏍️ Big bike', description: 'Harley, Ducati, Hayabusa, Triumph' });
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
      branches: [{ ...hub, vehicleTypes: [{ id: 'hatch', name: 'Small car', category: 'car' as const, bodyKey: null }], services: hub.services.slice(0, 1) }],
    };
    // "Small car" reads as a hatchback, so it still has its size.
    expect(as(only(reply({ kind: 'choice', id: 'cat|b1|car' }, custom).messages), 'list').rows[0]!.id).toBe('sz|b1|small');
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
        '🚙 *Large / 7-seater*',
        'For Creta, XUV700, Innova, Fortuner, BMW X5…',
        'Prices at *Sri Mana Wash*, Kovur',
        '',
        '🧽 *Washes*',
        '1️⃣ Express Wash: *₹419*',
        '2️⃣ Basic Wash ⭐: *₹799*',
        '3️⃣ Premium Wash: *₹1,399*',
        '4️⃣ Anti-Rust Protection: *₹4,500*',
        '',
        '✨ *Add-on* (with any wash)',
        '5️⃣ Premium Care: *+₹249*',
        '_Gentle shampoo, microfiber hand-dry, extra paint care_',
        '',
        '📅 *Monthly plans* (4 washes)',
        '6️⃣ Express Plan: *₹1,549* (save ₹127)',
        '7️⃣ Basic Plan ⭐: *₹2,949* (save ₹247)',
        '8️⃣ Shine Plan: *₹3,499* (save ₹297)',
        '💡 3 & 12-month plans save more: reply *PLANS*',
        '',
        "👉 Reply a number to see what's included",
      ].join('\n'),
    );
    expect(m.buttons).toEqual([
      { id: 'cat|b1|car', title: '🔁 Other size' },
      { id: 'loc|b1', title: '📍 Get Directions' },
      { id: 'talk|b1', title: '📞 Talk to us' },
    ]);
    // Remembered, so a number or PLANS reads from it.
    expect(r.context).toBe('sz|b1|large');
  });

  it('a mid-size car is priced from the sedan, and bikes by type', () => {
    const mid = bodyOf(only(choose('sz|b1|mid').messages));
    expect(mid).toContain('🚘 *Mid-size car*\nFor Dzire, City, Nexon, Brezza, BMW 3 Series…');
    expect(mid).toContain('1️⃣ Express Wash: *₹349*');
    const big = as(only(choose('sz|b1|bigBike').messages), 'buttons');
    expect(big.text).toContain('🏍️ *Big bike*\nFor Harley, Ducati, Hayabusa, Triumph…');
    expect(big.text).toContain('1️⃣ Bike Basic Wash ⭐: *₹299*');
    expect(big.text).not.toContain('Monthly plans');
    expect(big.buttons[0]).toEqual({ id: 'cat|b1|bike', title: '🔁 Other type' });
  });

  it('a size the branch no longer prices goes back to the start of prices', () => {
    const noLarge = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.id !== 'suv') }] };
    expect(as(only(reply({ kind: 'choice', id: 'sz|b1|large' }, noLarge).messages), 'buttons').text).toBe('Which prices would you like to see?');
  });
});

describe('WhatsApp assistant: numbers and PLANS', () => {
  it('a number shows what that wash includes, with a way back to the size’s prices', () => {
    const m = as(only(reply({ kind: 'text', text: '1' }, after('sz|b1|large')).messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '1️⃣ *Express Wash*',
        '🚙 Large / 7-seater · *₹419*',
        '',
        'A quick, careful outside wash.',
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
      { id: 'sz|b1|large', title: '📋 Large car prices' },
      { id: 'loc|b1', title: '📍 Get Directions' },
      { id: 'talk|b1', title: '📞 Talk to us' },
    ]);
  });

  it('the add-on and a monthly plan explain themselves', () => {
    const care = bodyOf(only(reply({ kind: 'text', text: '5' }, after('sz|b1|small')).messages));
    expect(care).toContain('5️⃣ *Premium Care*\n🚗 Small car · *+₹249*');
    expect(care).toContain('• pH-neutral shampoo');
    expect(care).toContain('⏱️ Adds about 15 minutes');
    expect(care).toContain('Ask for it with any wash at the counter.');
    const shine = bodyOf(only(reply({ kind: 'text', text: '8' }, after('sz|b1|small')).messages));
    expect(shine).toContain('8️⃣ *Shine Plan*\n🚗 Small car · *₹2,199* (save ₹197)');
    expect(shine).toContain('📅 4 washes in a month: a *Basic Wash* each time, and every 4th a *Premium Wash*');
    expect(shine).toContain("💡 That's *₹550* a wash.");
    expect(shine).toContain('Buy it at the counter on your next visit.');
  });

  it('a number past the end asks for one in range; without a list it’s a hello', () => {
    expect(bodyOf(only(reply({ kind: 'text', text: '9' }, after('sz|b1|large')).messages))).toBe('Please pick a number from *1* to *8*. 🙏');
    expect(as(only(text('2').messages), 'buttons').imageUrl).toBeDefined();
  });

  it('PLANS lists every plan for the size, by plan, numbered', () => {
    const r = reply({ kind: 'text', text: 'PLANS' }, after('sz|b1|small'));
    const m = as(only(r.messages), 'buttons');
    expectValid([m]);
    expect(m.text).toBe(
      [
        '📅 *Wash plans* · 🚗 Small car',
        'Pay once, wash all month. Longer plans save more.',
        '',
        '*Express Plan*: an *Express Wash* each time',
        '1️⃣ 4 washes in a month: *₹1,099* (save ₹97)',
        '2️⃣ 13 washes in 3 months: *₹3,297* (save ₹590)',
        '3️⃣ 52 washes in 13 months: *₹13,188* (save ₹2,360)',
        '',
        '*Basic Plan* ⭐: a *Basic Wash* each time',
        '4️⃣ 4 washes in a month: *₹1,849* (save ₹147)',
        '5️⃣ 13 washes in 3 months: *₹5,547* (save ₹940)',
        '',
        '*Shine Plan*: a *Basic Wash* each time, and every 4th a *Premium Wash*',
        '6️⃣ 4 washes in a month: *₹2,199* (save ₹197)',
        '',
        "👉 Reply a number to see what's included",
        'Buy at the counter on your next visit.',
      ].join('\n'),
    );
    expect(m.buttons.map((b) => b.id)).toEqual(['sz|b1|small', 'loc|b1', 'talk|b1']);
    expect(r.context).toBe('pl|b1|sz|small');
    for (const word of ['plans', 'Plan', 'monthly plans', 'ప్లాన్‌లు']) {
      expect(reply({ kind: 'text', text: word }, after('sz|b1|small')).context).toBe('pl|b1|sz|small');
    }
  });

  it('a number after PLANS shows that plan', () => {
    const m = as(only(reply({ kind: 'text', text: '2' }, after('pl|b1|sz|small')).messages), 'buttons');
    expectValid([m]);
    expect(m.text).toContain('2️⃣ *Express Plan · 3 months*\n🚗 Small car · *₹3,297* (save ₹590)');
    expect(m.text).toContain('📅 13 washes in 3 months: an *Express Wash* each time');
    expect(m.text).toContain("💡 That's *₹254* a wash.");
    expect(m.buttons.map((b) => b.id)).toEqual(['pl|b1|sz|small', 'sz|b1|small', 'talk|b1']);
    expect(bodyOf(only(reply({ kind: 'text', text: '7' }, after('pl|b1|sz|small')).messages))).toBe('Please pick a number from *1* to *6*. 🙏');
  });

  it('PLANS before any price list asks for the vehicle first', () => {
    const out = text('plans').messages;
    expect(bodyOf(out[0]!)).toBe("Pick your vehicle first and we'll show its plans. 👇");
    expect(as(out[1], 'buttons').buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike']);
  });

  it('a size with no plans says so', () => {
    expect(bodyOf(only(choose('pl|b1|sz|bigBike').messages))).toBe("We don't have wash plans for the *Big bike* yet. 🙏");
  });
});

describe('WhatsApp assistant: finding a model', () => {
  it('Not sure? walks company → model → “Brezza is a Mid-size car” with mid-size prices', () => {
    const makes = as(only(choose('find|b1|car').messages), 'list');
    expectValid([makes]);
    expect(makes.rows[0]!.title).toBe('Maruti Suzuki');
    // Tractors and buses aren't on a branch that only washes cars.
    expect(makes.rows.some((r) => r.title === 'Mahindra Construction')).toBe(false);

    const models = as(only(choose(makes.rows[0]!.id).messages), 'list');
    expectValid([models]);
    expect(models.rows.every((r) => r.id.startsWith('pr|b1|Maruti Suzuki|') || r.id.startsWith('mo|b1|car|Maruti Suzuki|'))).toBe(true);
    expect(models.rows.filter((r) => r.id.startsWith('pr|')).every((r) => ['Small car', 'Mid-size car', 'Large / 7-seater'].includes(r.description!))).toBe(true);

    const r = choose('pr|b1|Maruti Suzuki|Brezza');
    const m = as(only(r.messages), 'buttons');
    expectValid([m]);
    expect(m.text.startsWith('🚘 *Maruti Suzuki Brezza* is a *Mid-size car*.\nMid-size prices at *Sri Mana Wash*, Kovur\n\n🧽 *Washes*\n1️⃣ Express Wash: *₹349*')).toBe(true);
    expect(m.buttons[0]).toEqual({ id: 'cat|b1|car', title: '🔁 Other size' });
    expect(r.context).toBe('pr|b1|Maruti Suzuki|Brezza');
    // A number after it reads from the same list.
    const detail = as(only(reply({ kind: 'text', text: '5' }, after('pr|b1|Maruti Suzuki|Brezza')).messages), 'buttons');
    expect(detail.text).toContain('5️⃣ *Premium Care*\n🚘 Maruti Suzuki Brezza · *+₹249*');
    expect(detail.buttons[0]).toEqual({ id: 'pr|b1|Maruti Suzuki|Brezza', title: '📋 All prices' });
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
    expect(bodyOf(only(text('swift').messages))).toContain('🚗 *Maruti Suzuki Swift* is a *Small car*.\nSmall car prices at');
    expect(text('swift').context).toBe('pr|b1|Maruti Suzuki|Swift');
    expect(bodyOf(only(text('Activa').messages))).toContain('🛵 *Honda Activa* is a *Scooter*.');
    expect(bodyOf(only(text('my car is a creta').messages))).toContain('🚙 *Hyundai Creta* is a *Large / 7-seater*.');
    const x5 = bodyOf(only(text('BMW X5').messages));
    expect(x5).toContain('🚙 *BMW X5* is a *Large / 7-seater*.\nLarge car prices at');
    expect(x5).toContain('1️⃣ Express Wash: *₹419*');
    expect(bodyOf(only(choose('pr|b1|BMW|3 Series').messages))).toContain('🚘 *BMW 3 Series* is a *Mid-size car*.');
    expect(bodyOf(only(choose('pr|b1|Harley-Davidson|Fat Boy').messages))).toContain('*Big bike*');
    expect(bodyOf(only(choose('pr|b1|Royal Enfield|Classic 350').messages))).toContain('*Bike*');
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
    expect((models.data.models as { id: string; description: string }[]).find((r) => r.id === 'Swift')?.description).toBe('Small car');
    const prices = chatFlowReply({ action: 'data_exchange', screen: 'MODEL', data: { step: 'model', company: 'Maruti Suzuki', model: 'Swift' }, flow_token: token }, ctx);
    expect(prices.screen).toBe('PRICES');
    const md = prices.data.prices as string;
    expect(md).toContain('# 🚗 Maruti Suzuki Swift\nA small car · Sri Mana Wash, Kovur');
    expect(md).toContain('2. **Basic Wash** ⭐ — ₹499');
    expect(md).toContain('5. **Premium Care** — +₹249 · Gentle shampoo, microfiber hand-dry, extra paint care');
    expect(md).toContain('7. **Basic Plan** ⭐ — ₹1,849 · 4 washes in a month (save ₹147)');
    expect(md).toContain('💡 3 & 12-month plans save more: reply **PLANS**');
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
