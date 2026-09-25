import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@mana/domain';
import { SHOP } from '../config/shop';
import { formatRupees } from './format';

export interface ThankYouInput {
  /** Used to pick a sign-off line, so repeat customers don't get the same joke every time. */
  jobId: string;
  customerName: string | null | undefined;
  registrationNumber: string;
  vehicleType?: string;
  services: { name: string; quantity?: number }[];
  total: number;
  discount?: number | null;
  paymentMethod?: string | null;
  visitedAt: string | Date;
}

const SIGN_OFFS = [
  'If it rains tomorrow, please blame the clouds, not us ☔😄',
  'Warning: people may stare. That’s just the shine talking ✨😎',
  'Your ride is now officially cleaner than our break room 😄',
  'Drive safe, and try to dodge the puddles for at least a day 😉',
];

function pickSignOff(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SIGN_OFFS[hash % SIGN_OFFS.length]!;
}

function yourVehicle(registrationNumber: string, vehicleType?: string): string {
  // Walk-ins are stored as WALK-IN-<timestamp>; never show that to a customer.
  if (registrationNumber.startsWith('WALK-IN'))
    return vehicleType ? `Your ${vehicleType}` : 'Your vehicle';
  return vehicleType
    ? `Your *${registrationNumber}* (${vehicleType})`
    : `Your *${registrationNumber}*`;
}

function paidOn(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

function paymentLabel(method?: string | null): string | null {
  if (!method) return null;
  return PAYMENT_METHOD_LABEL[method as PaymentMethod] ?? null;
}

export interface ReminderInput {
  customerName: string | null | undefined;
  registrationNumber: string;
  vehicleType?: string;
  daysSince: number;
  lastServices: string[];
}

/** Gentle "your car is due" nudge for a vehicle that hasn't been in for a while. */
export function buildReminderMessage(input: ReminderInput): string {
  const firstName = input.customerName?.trim().split(/\s+/)[0];
  const last = input.lastServices.length > 0 ? ` (${input.lastServices.join(' + ')})` : '';
  return [
    `Hi ${firstName || 'there'}! 👋`,
    '',
    `It’s been ${input.daysSince} days since ${yourVehicle(input.registrationNumber, input.vehicleType).replace(/^Your/, 'your')} got its last wash${last} at *${SHOP.name}* 🚿`,
    '',
    'Dust and grime build up fast — drop by whenever it suits you and we’ll have it shining again ✨',
    '',
    'See you soon!',
    `*Team ${SHOP.name}*`,
  ].join('\n');
}

export interface ComebackOfferInput {
  customerName: string | null | undefined;
  registrationNumber: string;
  vehicleType?: string;
  code: string;
  percent: number;
  expiresAt: string | Date;
}

/** Comeback coupon message. Spells out exactly where the code works so there's no argument later. */
export function buildComebackMessage(input: ComebackOfferInput): string {
  const firstName = input.customerName?.trim().split(/\s+/)[0];
  const expires = new Date(input.expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return [
    `Hi ${firstName || 'there'}! 👋`,
    '',
    `We’ve missed ${yourVehicle(input.registrationNumber, input.vehicleType).replace(/^Your/, 'your')} at *${SHOP.name}* 🚿`,
    '',
    `Here’s a little welcome-back gift: *${input.percent}% off* your next wash 🎁`,
    '',
    `🎟️ Code: *${input.code}*`,
    `📅 Valid till *${expires}*`,
    '',
    `_Valid once, for ${input.registrationNumber} or your other vehicles registered with us. Not combinable with other offers._`,
    '',
    'Just show this message at the counter. See you soon!',
    `*Team ${SHOP.name}*`,
  ].join('\n');
}

/**
 * WhatsApp thank-you sent after a paid wash: receipt-style summary, a friendly review ask,
 * and a light sign-off. Uses WhatsApp formatting (*bold*, _italic_).
 */
export function buildThankYouMessage(input: ThankYouInput): string {
  const firstName = input.customerName?.trim().split(/\s+/)[0];
  const method = paymentLabel(input.paymentMethod);
  const discount = input.discount && input.discount > 0 ? input.discount : 0;

  const serviceLines = input.services.map((s) =>
    s.quantity && s.quantity > 1 ? `• ${s.name} × ${s.quantity}` : `• ${s.name}`,
  );

  const lines: string[] = [
    `Hi ${firstName || 'there'}! 👋`,
    '',
    `Thank you for choosing *${SHOP.name}* today. ${yourVehicle(input.registrationNumber, input.vehicleType)} is sparkling clean and ready to roll ✨`,
    '',
    '🧾 *Your wash summary*',
    ...(serviceLines.length > 0 ? serviceLines : ['• Wash']),
    '',
    `💰 Paid: *${formatRupees(input.total)}*${method ? ` via ${method}` : ''}`,
    ...(discount > 0 ? [`🎁 You saved: *${formatRupees(discount)}*`] : []),
    `📅 ${paidOn(input.visitedAt)}`,
    '',
    'We hope it looks great — our team gave it some serious elbow grease 💪',
    '',
    '⭐ *Got 30 seconds?*',
    'If you loved the shine, a quick Google review would truly make our day. It helps a small local shop like ours more than you know 🙏',
    `👉 ${SHOP.reviewUrl}`,
    '',
    'See you next time!',
    `_${pickSignOff(input.jobId)}_`,
    '',
    'Warm regards,',
    `*Team ${SHOP.name}* 🚿`,
  ];

  return lines.join('\n');
}
