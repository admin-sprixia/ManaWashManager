import { hoursSummary, type OpeningHours } from './customerApp';
import type { VehicleCategory } from './types';
import { bodyTypeDef, bodyTypeForName } from './vehicleCatalog';
import { VEHICLE_MAKES, vehicleGuideRows, vehicleTypeKeysFor, type VehicleGuideRow, type VehicleModelEdit } from './vehicleMakes';

/**
 * The WhatsApp assistant on the business number: a customer says anything and picks Car or
 * Bike, then the company and the model from WhatsApp lists, and gets that model's hub prices at
 * the branch. Typing a model ("swift", "activa") jumps straight to it. Pure: the API feeds in
 * the branches and what the customer sent, and sends back what this returns.
 *
 * Every button and list row carries everything the next step needs in its id
 * ("mo|<branch>|car|Maruti Suzuki|0"), so the assistant keeps no conversation state.
 */

// WhatsApp's limits for interactive messages.
export const WA_MAX_BUTTONS = 3;
export const WA_MAX_LIST_ROWS = 10;
export const WA_BUTTON_TITLE_MAX = 20;
export const WA_ROW_TITLE_MAX = 24;
export const WA_ROW_DESCRIPTION_MAX = 72;
export const WA_BUTTONS_BODY_MAX = 1024;
export const WA_ID_MAX = 200;

export interface ChatBranch {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  location: { latitude: number; longitude: number } | null;
  hours: OpeningHours;
  reviewUrl: string | null;
  vehicleTypes: { id: string; name: string; category: VehicleCategory; bodyKey: string | null }[];
  /** Hub services in menu order, prices in paise. */
  services: { id: string; name: string; popular: boolean; prices: { vehicleTypeId: string; price: number }[] }[];
  /** Wash plans sold at the shop, prices in paise. */
  plans: {
    name: string;
    washes: number;
    months: number;
    popular: boolean;
    prices: { vehicleTypeId: string; total: number; listTotal: number }[];
  }[];
}

export interface ChatContext {
  /** The name customers know, e.g. "Sri Mana Wash". */
  businessName: string;
  branches: ChatBranch[];
  /** Head office's changes to the model list. */
  edits?: readonly VehicleModelEdit[];
}

export type ChatInput = { kind: 'text'; text: string } | { kind: 'choice'; id: string };

export interface ChatButton {
  id: string;
  title: string;
}
export interface ChatRow {
  id: string;
  title: string;
  description?: string;
}

export type ChatMessage =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: ChatButton[]; footer?: string }
  | { type: 'list'; text: string; button: string; title: string; rows: ChatRow[]; footer?: string }
  | { type: 'location'; latitude: number; longitude: number; name: string; address: string };

export interface ChatResult {
  messages: ChatMessage[];
  /** The customer asked for no more offers and reminders (STOP), or asked for them again (START). */
  marketing?: 'stop' | 'start';
}

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop offers', 'no offers', 'opt out', 'optout']);
const START_WORDS = new Set(['start', 'subscribe', 'opt in', 'optin']);
const THANKS = /^(thanks?( you)?|thank u|thx|ty|ok(ay)?|k|👍|🙏|super|great|nice|good)(\s|[.!]|🙏|👍|😊)*$/iu;

const PAGE_ROWS = WA_MAX_LIST_ROWS - 1;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

// ─── Ids ─────────────────────────────────────────────────────────────────────

const id = (...parts: (string | number)[]) => parts.map((p) => String(p).replace(/\|/g, '/')).join('|');

/** The quick-reply id on the bill's "Rate us" button. */
export const rateChoiceId = (branchId: string) => id('rate', branchId);

// ─── Vehicles at a branch ────────────────────────────────────────────────────

/** A vehicle type's catalog key: its linked body type, else what its name suggests. */
function typeKey(t: ChatBranch['vehicleTypes'][number]): string | null {
  return t.bodyKey ?? bodyTypeForName(t.name)?.key ?? null;
}

/** The branch's vehicle type for a listed model (Swift → Hatchback), best fit first. */
export function chatVehicleType(
  branch: ChatBranch,
  make: string,
  model: string,
  edits: readonly VehicleModelEdit[] = [],
): ChatBranch['vehicleTypes'][number] | null {
  const keys = vehicleTypeKeysFor(make, model, edits);
  if (!keys) return null;
  for (const key of keys) {
    const match = branch.vehicleTypes.find((t) => typeKey(t) === key);
    if (match) return match;
  }
  return null;
}

const priced = (branch: ChatBranch, typeId: string) =>
  branch.services.some((s) => s.prices.some((p) => p.vehicleTypeId === typeId && p.price > 0));

/** The listed models this branch washes and has prices for, in one category. */
function modelsAt(branch: ChatBranch, category: VehicleCategory, edits: readonly VehicleModelEdit[]): VehicleGuideRow[] {
  return vehicleGuideRows(edits).filter((r) => {
    if (r.category !== category) return false;
    const t = chatVehicleType(branch, r.make, r.model, edits);
    return !!t && priced(branch, t.id);
  });
}

/** Companies in the order people pick them (Maruti Suzuki first), then ones head office added. */
function makesAt(branch: ChatBranch, category: VehicleCategory, edits: readonly VehicleModelEdit[]): string[] {
  const present = new Set(modelsAt(branch, category, edits).map((r) => r.make));
  const ordered = VEHICLE_MAKES.filter((m) => m.category === category && present.has(m.name)).map((m) => m.name);
  const extra = [...present].filter((m) => !ordered.includes(m)).sort((a, b) => a.localeCompare(b));
  return [...new Set([...ordered, ...extra])];
}

const hasCategory = (branch: ChatBranch, category: VehicleCategory, edits: readonly VehicleModelEdit[]) =>
  modelsAt(branch, category, edits).length > 0;

// ─── Messages ────────────────────────────────────────────────────────────────

function branchLine(ctx: ChatContext, b: ChatBranch): string {
  const place = b.city ? `, ${b.city}` : '';
  return ctx.branches.length > 1 ? `*${b.name}*${place}` : `*${ctx.businessName}*${place}`;
}

/** Car / Bike / Location: the start of every conversation. */
function welcome(ctx: ChatContext, b: ChatBranch, lead?: string): Extract<ChatMessage, { type: 'buttons' }> {
  const edits = ctx.edits ?? [];
  const buttons: ChatButton[] = [];
  if (hasCategory(b, 'car', edits)) buttons.push({ id: id('cat', b.id, 'car'), title: '🚗 Car' });
  if (hasCategory(b, 'bike', edits)) buttons.push({ id: id('cat', b.id, 'bike'), title: '🏍️ Bike' });
  buttons.push({ id: id('loc', b.id), title: '📍 Location & hours' });
  if (buttons.length < WA_MAX_BUTTONS) buttons.push({ id: id('talk', b.id), title: '💬 Talk to us' });
  const example = buttons.some((x) => x.id.endsWith('|bike')) ? '*Swift*, *Creta* or *Activa*' : '*Swift* or *Creta*';
  return {
    type: 'buttons',
    text: [
      lead ?? `Hi! 👋 Welcome to ${branchLine(ctx, b)}.`,
      '',
      `Pick your vehicle to see our prices, or just type your model (like ${example}).`,
    ].join('\n'),
    buttons,
  };
}

/** More than one branch: which one first. */
function branchPicker(ctx: ChatContext, lead?: string): ChatMessage {
  return {
    type: 'list',
    text: `${lead ?? `Hi! 👋 Welcome to *${ctx.businessName}*.`}\n\nWhich branch would you like prices for?`,
    button: 'Choose branch',
    title: 'Branches',
    rows: ctx.branches.slice(0, WA_MAX_LIST_ROWS).map((b) => ({
      id: id('br', b.id),
      title: cut(b.name, WA_ROW_TITLE_MAX),
      description: cut([b.city, b.address].filter(Boolean).join(' · '), WA_ROW_DESCRIPTION_MAX) || undefined,
    })),
  };
}

function start(ctx: ChatContext, lead?: string): ChatMessage {
  return ctx.branches.length === 1 ? welcome(ctx, ctx.branches[0]!, lead) : branchPicker(ctx, lead);
}

function makeList(ctx: ChatContext, b: ChatBranch, category: VehicleCategory, page: number): ChatMessage {
  const makes = makesAt(b, category, ctx.edits ?? []);
  const from = page * PAGE_ROWS;
  const shown = makes.slice(from, from + PAGE_ROWS);
  const rows: ChatRow[] = shown.map((m) => ({ id: id('mo', b.id, category, m, 0), title: cut(m, WA_ROW_TITLE_MAX) }));
  if (from + PAGE_ROWS < makes.length) {
    rows.push({ id: id('mk', b.id, category, page + 1), title: 'More companies ›', description: `${makes.length - from - PAGE_ROWS} more` });
  }
  return {
    type: 'list',
    text: `Which company makes your ${category === 'bike' ? 'bike or scooter' : 'car'}?\n\n_Or just type the model name._`,
    button: 'Choose company',
    title: page === 0 ? 'Companies' : `Companies (${page + 1})`,
    rows,
  };
}

function modelList(ctx: ChatContext, b: ChatBranch, category: VehicleCategory, make: string, page: number): ChatMessage {
  const models = modelsAt(b, category, ctx.edits ?? []).filter((r) => r.make === make);
  const from = page * PAGE_ROWS;
  const shown = models.slice(from, from + PAGE_ROWS);
  const rows: ChatRow[] = shown.map((r) => ({
    id: id('pr', b.id, r.make, r.model),
    title: cut(r.model, WA_ROW_TITLE_MAX),
    description: bodyTypeDef(r.bodyKey)?.label,
  }));
  if (from + PAGE_ROWS < models.length) {
    rows.push({ id: id('mo', b.id, category, make, page + 1), title: 'More models ›', description: `${models.length - from - PAGE_ROWS} more` });
  }
  return {
    type: 'list',
    text: `Which *${make}* is it?`,
    button: 'Choose model',
    title: cut(page === 0 ? make : `${make} (${page + 1})`, WA_ROW_TITLE_MAX),
    rows,
  };
}

function afterPrices(b: ChatBranch): ChatButton[] {
  return [
    { id: id('loc', b.id), title: '📍 Location & hours' },
    { id: id('home', b.id), title: '🔁 Another vehicle' },
    { id: id('talk', b.id), title: '💬 Talk to us' },
  ];
}

/** That model's services and plans at the branch, or why there are none. */
function prices(ctx: ChatContext, b: ChatBranch, make: string, model: string): ChatMessage[] {
  const edits = ctx.edits ?? [];
  const type = chatVehicleType(b, make, model, edits);
  const services = type
    ? b.services.flatMap((s) => {
        const p = s.prices.find((x) => x.vehicleTypeId === type.id && x.price > 0);
        return p ? [{ name: s.name, popular: s.popular, price: p.price }] : [];
      })
    : [];
  if (!type || services.length === 0) {
    return [
      {
        type: 'buttons',
        text: `Sorry, we don't wash the *${make} ${model}* at ${branchLine(ctx, b)} yet. 🙏`,
        buttons: afterPrices(b),
      },
    ];
  }
  const plans = b.plans.flatMap((p) => {
    const price = p.prices.find((x) => x.vehicleTypeId === type.id);
    return price ? [{ ...p, price }] : [];
  });
  const hours = hoursSummary(b.hours);
  const text = [
    `🚘 *${make} ${model}* · ${type.name}`,
    `Prices at ${branchLine(ctx, b)}`,
    '',
    ...services.map((s) => `• ${s.name}${s.popular ? ' ⭐' : ''}: *${rupees(s.price)}*`),
    ...(plans.length
      ? [
          '',
          '📅 *Wash plans*',
          ...plans.map((p) => {
            const saving = p.price.listTotal - p.price.total;
            const span = p.months === 1 ? 'a month' : `${p.months} months`;
            return `• ${p.name}${p.popular ? ' ⭐' : ''}: ${p.washes} washes in ${span}, *${rupees(p.price.total)}*${saving > 0 ? ` (save ${rupees(saving)})` : ''}`;
          }),
        ]
      : []),
    ...(hours ? ['', `🕒 ${hours}`] : []),
  ].join('\n');
  if (text.length <= WA_BUTTONS_BODY_MAX) return [{ type: 'buttons', text, buttons: afterPrices(b) }];
  return [
    { type: 'text', text },
    { type: 'buttons', text: 'Anything else?', buttons: afterPrices(b) },
  ];
}

function mapsLink(b: ChatBranch): string | null {
  return b.location ? `https://maps.google.com/?q=${b.location.latitude},${b.location.longitude}` : null;
}

function locationReply(ctx: ChatContext, b: ChatBranch): ChatMessage[] {
  const hours = hoursSummary(b.hours);
  const name = ctx.branches.length > 1 ? b.name : ctx.businessName;
  const out: ChatMessage[] = [];
  if (b.location) {
    out.push({
      type: 'location',
      latitude: b.location.latitude,
      longitude: b.location.longitude,
      name,
      address: b.address ?? b.city ?? '',
    });
  }
  const link = mapsLink(b);
  out.push({
    type: 'buttons',
    text: [
      `📍 *${name}*`,
      ...(b.address ? [b.address] : b.city ? [b.city] : []),
      ...(hours ? ['', `🕒 ${hours}`] : []),
      ...(b.phone ? [`📞 ${formatPhone(b.phone)}`] : []),
      ...(link && !b.location ? ['', link] : []),
    ].join('\n'),
    buttons: [
      ...welcome(ctx, b).buttons.filter((x) => x.id.startsWith('cat|')),
      { id: id('talk', b.id), title: '💬 Talk to us' },
    ].slice(0, WA_MAX_BUTTONS),
  });
  return out;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : phone;
}

function talkReply(ctx: ChatContext, b: ChatBranch): ChatMessage[] {
  if (!b.phone) {
    return [{ type: 'text', text: `Please visit us at ${branchLine(ctx, b)}${b.address ? `, ${b.address}` : ''}. We'd love to help! 😊` }];
  }
  const d = b.phone.replace(/\D/g, '').slice(-10);
  return [
    {
      type: 'text',
      text: [
        'This number sends prices and bills automatically. To talk to our team, call or WhatsApp us:',
        '',
        `📞 *${formatPhone(b.phone)}*`,
        `💬 https://wa.me/91${d}`,
      ].join('\n'),
    },
  ];
}

function rateReply(ctx: ChatContext, b: ChatBranch): ChatMessage[] {
  if (!b.reviewUrl) {
    return [{ type: 'text', text: `Thank you! 🙏 We're glad you chose ${branchLine(ctx, b)}. See you next time! 🚿` }];
  }
  return [
    {
      type: 'text',
      text: [
        'Thank you! 🙏 A quick Google review helps a local wash like ours more than you know:',
        '',
        `👉 ${b.reviewUrl}`,
      ].join('\n'),
    },
  ];
}

// ─── Typed model names ───────────────────────────────────────────────────────

/** Listed models the text names, best first: "swift", "maruti swift", "my car is a creta". */
export function findModels(text: string, rows: readonly VehicleGuideRow[]): VehicleGuideRow[] {
  const q = alnum(text);
  if (q.length < 2) return [];
  const exact = rows.filter((r) => alnum(r.model) === q || alnum(`${r.make}${r.model}`) === q);
  if (exact.length) return exact;
  // The text contains a model's whole name: keep the longest (so "swift dzire" beats "swift").
  const inText = rows.filter((r) => alnum(r.model).length >= 3 && q.includes(alnum(r.model)));
  if (inText.length) {
    const longest = Math.max(...inText.map((r) => alnum(r.model).length));
    return inText.filter((r) => alnum(r.model).length === longest);
  }
  if (q.length < 3) return [];
  return rows.filter((r) => alnum(r.model).includes(q) || alnum(`${r.make}${r.model}`).includes(q));
}

function typedModel(ctx: ChatContext, b: ChatBranch, text: string): ChatMessage[] | null {
  const edits = ctx.edits ?? [];
  const washed = [...modelsAt(b, 'car', edits), ...modelsAt(b, 'bike', edits)];
  const found = findModels(text, washed);
  if (found.length === 1) return prices(ctx, b, found[0]!.make, found[0]!.model);
  if (found.length > 1 && found.length <= WA_MAX_LIST_ROWS) {
    return [
      {
        type: 'list',
        text: `Which one is yours?`,
        button: 'Choose model',
        title: 'Models',
        rows: found.map((r) => ({
          id: id('pr', b.id, r.make, r.model),
          title: cut(r.model, WA_ROW_TITLE_MAX),
          description: cut(`${r.make} · ${bodyTypeDef(r.bodyKey)?.label ?? ''}`.replace(/ · $/, ''), WA_ROW_DESCRIPTION_MAX),
        })),
      },
    ];
  }
  if (found.length > WA_MAX_LIST_ROWS) {
    return [welcome(ctx, b, `There are a lot of models matching “${cut(text.trim(), 30)}”. Pick from the list instead:`)];
  }
  return null;
}

// ─── The reply ───────────────────────────────────────────────────────────────

function branchOf(ctx: ChatContext, branchId: string | undefined): ChatBranch | null {
  return ctx.branches.find((b) => b.id === branchId) ?? null;
}

/** What to send back for one message from a customer. */
export function chatReply(input: ChatInput, ctx: ChatContext): ChatResult {
  if (ctx.branches.length === 0) {
    return { messages: [{ type: 'text', text: `Thank you for contacting *${ctx.businessName}*. We'll be open for bookings soon! 🙏` }] };
  }
  const only = ctx.branches.length === 1 ? ctx.branches[0]! : null;

  if (input.kind === 'text') {
    const text = input.text.trim();
    const lower = text.toLowerCase().replace(/[.!]+$/, '');
    if (STOP_WORDS.has(lower)) {
      return {
        marketing: 'stop',
        messages: [{ type: 'text', text: "Done ✅ You won't get offers or reminders from us any more. Bills for your washes will still come here. Send *START* to turn offers back on." }],
      };
    }
    if (START_WORDS.has(lower)) {
      return {
        marketing: 'start',
        messages: [{ type: 'text', text: "You're back on our list ✅ We'll send you offers and wash reminders now and then. Send *STOP* any time." }, start(ctx)],
      };
    }
    if (THANKS.test(text)) return { messages: [{ type: 'text', text: "You're welcome! 😊 Send *Hi* any time for our prices." }] };
    if (only && text) {
      const found = typedModel(ctx, only, text);
      if (found) return { messages: found };
    }
    return { messages: [start(ctx)] };
  }

  const [kind, branchId, ...rest] = input.id.split('|');
  const b = branchOf(ctx, branchId) ?? only;
  if (!b) return { messages: [start(ctx)] };
  const category: VehicleCategory = rest[0] === 'bike' ? 'bike' : 'car';
  switch (kind) {
    case 'br':
    case 'home':
      return { messages: [welcome(ctx, b, kind === 'home' ? 'Sure! Which vehicle?' : undefined)] };
    case 'cat':
      return { messages: [makeList(ctx, b, category, 0)] };
    case 'mk':
      return { messages: [makeList(ctx, b, category, Number(rest[1]) || 0)] };
    case 'mo':
      return { messages: [modelList(ctx, b, category, rest[1] ?? '', Number(rest[2]) || 0)] };
    case 'pr':
      return { messages: prices(ctx, b, rest[0] ?? '', rest[1] ?? '') };
    case 'loc':
      return { messages: locationReply(ctx, b) };
    case 'talk':
      return { messages: talkReply(ctx, b) };
    case 'rate':
      return { messages: rateReply(ctx, b) };
    default:
      return { messages: [start(ctx)] };
  }
}

