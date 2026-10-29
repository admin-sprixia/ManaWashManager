import type { ChatLang } from './whatsappChat';
import type { PaymentMethod } from './types';

/**
 * The WhatsApp templates the business number sends on its own: "ready for pickup" when a wash
 * moves to Ready, and the bill with a thank-you when it's paid. Meta approves each template (per
 * language) before it can be sent; `WA_TEMPLATES` is exactly what gets submitted, and the
 * functions below fill in the blanks for one wash. Parameters can't hold line breaks, so lists
 * are joined on one line.
 */

/** ready: pickup; bill: the thank-you and bill as text; invoice: the same with the PDF bill attached. */
export type WashTemplateKind = 'ready' | 'bill' | 'invoice';

export interface WaTemplateDefinition {
  name: string;
  language: ChatLang;
  /** UTILITY: about a wash they had or a plan they hold. MARKETING: reminders and offers (STOP-able). */
  category: 'UTILITY' | 'MARKETING';
  /** A document (the PDF bill) on top, chosen per message. */
  header?: 'DOCUMENT';
  body: string;
  /** One example per {{n}}, for Meta's review. */
  example: string[];
  /** Quick-reply buttons (plain text: Meta refuses emojis or formatting); what each sends back is set per message. */
  buttons: string[];
}

export const WA_TEMPLATE_NAMES: Record<WashTemplateKind, string> = { ready: 'wash_ready', bill: 'wash_bill', invoice: 'wash_invoice' };

export const WA_TEMPLATES: WaTemplateDefinition[] = [
  {
    name: 'wash_ready',
    language: 'en',
    category: 'UTILITY',
    body: [
      'Hi {{1}}, your {{2}} is washed and ready for pickup at {{3}}. ✨',
      '',
      'Amount due: *{{4}}*',
      '',
      'See you soon!',
    ].join('\n'),
    example: ['Ravi', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur', '₹499'],
    buttons: ['Get Directions'],
  },
  {
    name: 'wash_ready',
    language: 'te',
    category: 'UTILITY',
    body: [
      'నమస్కారం {{1}}, మీ {{2}} వాష్ పూర్తయింది. {{3}} లో తీసుకెళ్లడానికి సిద్ధంగా ఉంది. ✨',
      '',
      'చెల్లించవలసిన మొత్తం: *{{4}}*',
      '',
      'త్వరలో కలుద్దాం!',
    ].join('\n'),
    example: ['Ravi గారు', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur', '₹499'],
    buttons: ['దారి చూపించు'],
  },
  {
    name: 'wash_bill',
    language: 'en',
    category: 'UTILITY',
    body: [
      'Hi {{1}}, thank you for choosing {{2}}! 🙏',
      '',
      '🧾 *Your bill*',
      'Vehicle: {{3}}',
      'Services: {{4}}',
      'Paid: *{{5}}* by {{6}}',
      'Date: {{7}}',
      '',
      'We hope you love the shine. See you again soon!',
    ].join('\n'),
    example: ['Ravi', 'Sri Mana Wash, Kovur', 'Maruti Suzuki Swift (AP39AB1234)', 'Basic Wash, Interior Clean', '₹699 (you saved ₹50)', 'UPI', '28 Oct 2026, 6:30 pm'],
    buttons: ['Rate us'],
  },
  {
    name: 'wash_bill',
    language: 'te',
    category: 'UTILITY',
    body: [
      'నమస్కారం {{1}}, {{2}} ని ఎంచుకున్నందుకు ధన్యవాదాలు! 🙏',
      '',
      '🧾 *మీ బిల్లు*',
      'వాహనం: {{3}}',
      'సేవలు: {{4}}',
      'చెల్లించింది: *{{5}}* ({{6}})',
      'తేదీ: {{7}}',
      '',
      'మీకు మెరుపు నచ్చుతుందని ఆశిస్తున్నాం. మళ్ళీ కలుద్దాం!',
    ].join('\n'),
    example: ['Ravi గారు', 'Sri Mana Wash, Kovur', 'Maruti Suzuki Swift (AP39AB1234)', 'Basic Wash, Interior Clean', '₹699 (₹50 ఆదా)', 'UPI', '28 Oct 2026, 6:30 pm'],
    buttons: ['రేట్ చేయండి'],
  },
  {
    name: 'wash_invoice',
    language: 'en',
    category: 'UTILITY',
    header: 'DOCUMENT',
    body: [
      'Hi {{1}}, thank you for choosing {{2}}! 🙏',
      '',
      '🧾 *Your bill is attached*',
      'Vehicle: {{3}}',
      'Services: {{4}}',
      'Paid: *{{5}}* by {{6}}',
      'Date: {{7}}',
      '',
      'We hope you love the shine. See you again soon!',
    ].join('\n'),
    example: ['Ravi', 'Sri Mana Wash, Kovur', 'Maruti Suzuki Swift (AP39AB1234)', 'Basic Wash, Interior Clean', '₹699 (you saved ₹50)', 'UPI', '28 Oct 2026, 6:30 pm'],
    buttons: ['Rate us'],
  },
  {
    name: 'wash_invoice',
    language: 'te',
    category: 'UTILITY',
    header: 'DOCUMENT',
    body: [
      'నమస్కారం {{1}}, {{2}} ని ఎంచుకున్నందుకు ధన్యవాదాలు! 🙏',
      '',
      '🧾 *మీ బిల్లు జతచేయబడింది*',
      'వాహనం: {{3}}',
      'సేవలు: {{4}}',
      'చెల్లించింది: *{{5}}* ({{6}})',
      'తేదీ: {{7}}',
      '',
      'మీకు మెరుపు నచ్చుతుందని ఆశిస్తున్నాం. మళ్ళీ కలుద్దాం!',
    ].join('\n'),
    example: ['Ravi గారు', 'Sri Mana Wash, Kovur', 'Maruti Suzuki Swift (AP39AB1234)', 'Basic Wash, Interior Clean', '₹699 (₹50 ఆదా)', 'UPI', '28 Oct 2026, 6:30 pm'],
    buttons: ['రేట్ చేయండి'],
  },
  // ─── Follow-ups (sent each morning, never on the branch's day off) ───
  {
    name: 'wash_reminder',
    language: 'en',
    category: 'MARKETING',
    body: [
      "Hi {{1}}, it's been {{2}} days since your {{3}} was washed at {{4}}. ✨",
      '',
      "Time for a fresh shine? Just drive in, or tap below for today's prices.",
    ].join('\n'),
    example: ['Ravi', '12', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur'],
    buttons: ['See prices', 'Stop offers'],
  },
  {
    name: 'wash_reminder',
    language: 'te',
    category: 'MARKETING',
    body: [
      'నమస్కారం {{1}}, {{2}} రోజుల క్రితం మీ {{3}} ని {{4}} లో వాష్ చేశాం. ✨',
      '',
      'మళ్ళీ మెరిసిపోవాలా? నేరుగా రండి, లేదా ఈరోజు ధరల కోసం కింద నొక్కండి.',
    ].join('\n'),
    example: ['Ravi గారు', '12', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur'],
    buttons: ['ధరలు చూడండి', 'ఆఫర్లు ఆపండి'],
  },
  {
    name: 'comeback_offer',
    language: 'en',
    category: 'MARKETING',
    body: [
      'Hi {{1}}, we miss your {{2}} at {{3}}! 🎁',
      '',
      "Here's *{{4}}% off* your next wash.",
      'Code: *{{5}}*',
      'Valid till {{6}}',
      '',
      'Show this message at the counter. Valid once, for vehicles registered with us.',
    ].join('\n'),
    example: ['Ravi', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur', '8', 'MANA-1234-ABCDEF', '19 Nov 2026'],
    buttons: ['See prices', 'Stop offers'],
  },
  {
    name: 'comeback_offer',
    language: 'te',
    category: 'MARKETING',
    body: [
      'నమస్కారం {{1}}, మీ {{2}} ని {{3}} లో మిస్ అవుతున్నాం! 🎁',
      '',
      'మీ తదుపరి వాష్‌పై *{{4}}% తగ్గింపు*.',
      'కోడ్: *{{5}}*',
      '{{6}} వరకు చెల్లుతుంది',
      '',
      'ఈ మెసేజ్‌ను కౌంటర్ వద్ద చూపించండి. ఒక్కసారి మాత్రమే, మా దగ్గర నమోదైన వాహనాలకు.',
    ].join('\n'),
    example: ['Ravi గారు', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur', '8', 'MANA-1234-ABCDEF', '19 Nov 2026'],
    buttons: ['ధరలు చూడండి', 'ఆఫర్లు ఆపండి'],
  },
  {
    name: 'referral_reward',
    language: 'en',
    category: 'MARKETING',
    body: [
      'Hi {{1}}, thank you for sending {{2}} to {{3}}! 🙌',
      '',
      "Here's *{{4}}% off* your next wash.",
      'Code: *{{5}}*',
      'Valid till {{6}}',
      '',
      'Show this message at the counter.',
    ].join('\n'),
    example: ['Ravi', 'Suresh', 'Sri Mana Wash, Kovur', '10', 'MANA-1234-ABCDEF', '19 Nov 2026'],
    buttons: ['See prices', 'Stop offers'],
  },
  {
    name: 'referral_reward',
    language: 'te',
    category: 'MARKETING',
    body: [
      'నమస్కారం {{1}}, {{2}} ని {{3}} కి పంపినందుకు ధన్యవాదాలు! 🙌',
      '',
      'మీ తదుపరి వాష్‌పై *{{4}}% తగ్గింపు*.',
      'కోడ్: *{{5}}*',
      '{{6}} వరకు చెల్లుతుంది',
      '',
      'ఈ మెసేజ్‌ను కౌంటర్ వద్ద చూపించండి.',
    ].join('\n'),
    example: ['Ravi గారు', 'Suresh', 'Sri Mana Wash, Kovur', '10', 'MANA-1234-ABCDEF', '19 Nov 2026'],
    buttons: ['ధరలు చూడండి', 'ఆఫర్లు ఆపండి'],
  },
  {
    name: 'plan_ending',
    language: 'en',
    // Meta files plan reminders as marketing.
    category: 'MARKETING',
    body: [
      'Hi {{1}}, your {{2}} for {{3}} ends on {{4}}, and {{5}} washes are still left. 🚿',
      '',
      "Come in before then so you don't miss them. We're open {{6}}.",
      '',
      'See you soon!',
    ].join('\n'),
    example: ['Ravi', 'Basic Plan', 'Maruti Suzuki Swift (AP39AB1234)', '8 Nov 2026', '2', '7 am – 8 pm, closed Mondays'],
    buttons: ['Get Directions'],
  },
  {
    name: 'plan_ending',
    language: 'te',
    category: 'MARKETING',
    body: [
      'నమస్కారం {{1}}, మీ {{2}} ({{3}}) {{4}} న ముగుస్తుంది, ఇంకా {{5}} వాష్‌లు మిగిలి ఉన్నాయి. 🚿',
      '',
      'అవి వృథా కాకుండా ఆలోపు రండి. మేము {{6}} తెరిచి ఉంటాం.',
    ].join('\n'),
    example: ['Ravi గారు', 'Basic Plan', 'Maruti Suzuki Swift (AP39AB1234)', '8 Nov 2026', '2', '7 am – 8 pm, closed Mondays'],
    buttons: ['దారి చూపించు'],
  },
];

/** What one wash's message needs. Amounts in paise. */
export interface WashMessageInput {
  customerName: string | null;
  /** "Maruti Suzuki Swift", or the vehicle type when the model isn't known. */
  vehicle: string;
  registrationNumber: string;
  /** "Sri Mana Wash, Kovur". */
  place: string;
  services: { name: string; quantity: number }[];
  total: number;
  discount: number;
  paymentMethod: PaymentMethod | null;
  /** When it was paid. */
  at: Date;
  /** The quick-reply button's payload: directions for Ready, the review link for the bill. */
  buttonPayload: string;
}

/** A filled-in template, ready for the Cloud API's `template` object. */
export interface WashTemplateMessage {
  name: string;
  language: ChatLang;
  params: string[];
  buttonPayload: string;
  /** A plain-text copy for the message log. */
  preview: string;
}

/** Parameters can't be empty or hold line breaks, tabs or long runs of spaces. */
const clean = (s: string) => s.replace(/[\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300) || '-';
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function name(input: WashMessageInput, lang: ChatLang): string {
  const first = input.customerName?.trim().split(/\s+/)[0];
  if (lang === 'te') return first ? `${first} గారు` : 'మిత్రమా';
  return first || 'there';
}

/** "Maruti Suzuki Swift (AP39AB1234)"; a walk-in's stand-in plate (WALK-IN-…) is never shown. */
const vehicleLine = (input: WashMessageInput) =>
  input.registrationNumber.startsWith('WALK-IN') ? input.vehicle : `${input.vehicle} (${input.registrationNumber})`;

const PAYMENT_LABEL: Record<PaymentMethod, Record<ChatLang, string>> = {
  cash: { en: 'cash', te: 'నగదు' },
  upi: { en: 'UPI', te: 'UPI' },
  other: { en: 'card or other', te: 'కార్డ్ / ఇతర' },
};

/** "28 Oct 2026, 6:30 pm" in India time. */
export function washMessageDate(at: Date): string {
  const d = new Date(at.getTime() + (5 * 60 + 30) * 60_000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const h24 = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

function fill(def: WaTemplateDefinition, params: string[]): string {
  return def.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');
}

/** The message for one wash, in the customer's language. */
export function washTemplateMessage(kind: WashTemplateKind, input: WashMessageInput, lang: ChatLang): WashTemplateMessage {
  const templateName = WA_TEMPLATE_NAMES[kind];
  const def = WA_TEMPLATES.find((t) => t.name === templateName && t.language === lang)!;
  let params: string[];
  // The invoice is the bill with the PDF on top: the same words.
  if (kind === 'ready') {
    const due = input.total > 0 ? rupees(input.total) : lang === 'te' ? 'ఏమీ లేదు' : 'Nothing';
    params = [name(input, lang), vehicleLine(input), input.place, due];
  } else {
    const services = input.services.map((s) => (s.quantity > 1 ? `${s.name} × ${s.quantity}` : s.name)).join(', ');
    const saved = input.discount > 0 ? (lang === 'te' ? ` (${rupees(input.discount)} ఆదా)` : ` (you saved ${rupees(input.discount)})`) : '';
    const method = input.paymentMethod ? PAYMENT_LABEL[input.paymentMethod][lang] : lang === 'te' ? 'చెల్లించారు' : 'paid';
    params = [name(input, lang), input.place, vehicleLine(input), services || 'Wash', `${rupees(input.total)}${saved}`, method, washMessageDate(input.at)];
  }
  params = params.map(clean);
  return { name: templateName, language: lang, params, buttonPayload: input.buttonPayload, preview: fill(def, params) };
}

export type FollowUpKind = 'reminder' | 'comeback' | 'referral' | 'plan_ending';

export const FOLLOW_UP_TEMPLATE: Record<FollowUpKind, string> = {
  reminder: 'wash_reminder',
  comeback: 'comeback_offer',
  referral: 'referral_reward',
  plan_ending: 'plan_ending',
};

/** What one follow-up needs; the dates are already written out ("19 Nov 2026"). */
export type FollowUpInput = { customerName: string | null; place: string; branchId: string } & (
  | { kind: 'reminder'; vehicle: string; registrationNumber: string; days: number }
  | { kind: 'comeback'; vehicle: string; registrationNumber: string; percent: number; code: string; validTill: string }
  | { kind: 'referral'; friend: string | null; percent: number; code: string; validTill: string }
  | { kind: 'plan_ending'; plan: string; vehicle: string; registrationNumber: string; endsOn: string; washesLeft: number; hours: string }
);

/** A follow-up template filled in, with what each quick-reply button sends back. */
export interface FollowUpMessage {
  name: string;
  language: ChatLang;
  params: string[];
  /** One payload per button, in order: prices and STOP on offers, directions on plan endings. */
  buttonPayloads: string[];
  preview: string;
}

export function followUpMessage(input: FollowUpInput, lang: ChatLang): FollowUpMessage {
  const templateName = FOLLOW_UP_TEMPLATE[input.kind];
  const def = WA_TEMPLATES.find((t) => t.name === templateName && t.language === lang)!;
  const who = name({ customerName: input.customerName } as WashMessageInput, lang);
  const car = (vehicle: string, reg: string) => vehicleLine({ vehicle, registrationNumber: reg } as WashMessageInput);
  let params: string[];
  switch (input.kind) {
    case 'reminder':
      params = [who, String(input.days), car(input.vehicle, input.registrationNumber), input.place];
      break;
    case 'comeback':
      params = [who, car(input.vehicle, input.registrationNumber), input.place, String(input.percent), input.code, input.validTill];
      break;
    case 'referral':
      params = [who, input.friend?.trim().split(/\s+/)[0] || (lang === 'te' ? 'మీ స్నేహితుడు' : 'a friend'), input.place, String(input.percent), input.code, input.validTill];
      break;
    case 'plan_ending':
      params = [who, input.plan, car(input.vehicle, input.registrationNumber), input.endsOn, String(input.washesLeft), input.hours];
      break;
  }
  params = params.map(clean);
  const buttonPayloads = input.kind === 'plan_ending' ? [`loc|${input.branchId}`] : [`svc|${input.branchId}`, 'STOP'];
  return { name: templateName, language: lang, params, buttonPayloads, preview: fill(def, params) };
}
