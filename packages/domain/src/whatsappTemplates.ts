import type { ChatLang } from './whatsappChat';
import type { PaymentMethod } from './types';

/**
 * The WhatsApp templates the business number sends on its own: "ready for pickup" when a wash
 * moves to Ready, and the bill with a thank-you when it's paid. Meta approves each template (per
 * language) before it can be sent; `WA_TEMPLATES` is exactly what gets submitted, and the
 * functions below fill in the blanks for one wash. Parameters can't hold line breaks, so lists
 * are joined on one line.
 */

export type WashTemplateKind = 'ready' | 'bill';

export interface WaTemplateDefinition {
  name: string;
  language: ChatLang;
  category: 'UTILITY';
  body: string;
  /** One example per {{n}}, for Meta's review. */
  example: string[];
  /** Quick-reply buttons (plain text: Meta refuses emojis or formatting); what each sends back is set per message. */
  buttons: string[];
}

export const WA_TEMPLATE_NAMES: Record<WashTemplateKind, string> = { ready: 'wash_ready', bill: 'wash_bill' };

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
