import { SHOP } from '../config/shop';

function yourVehicle(registrationNumber: string, vehicleType?: string): string {
  // Walk-ins are stored as WALK-IN-<timestamp>; never show that to a customer.
  if (registrationNumber.startsWith('WALK-IN'))
    return vehicleType ? `Your ${vehicleType}` : 'Your vehicle';
  return vehicleType
    ? `Your *${registrationNumber}* (${vehicleType})`
    : `Your *${registrationNumber}*`;
}

export interface ReminderInput {
  customerName: string | null | undefined;
  registrationNumber: string;
  vehicleType?: string;
  daysSince: number;
  lastServices: string[];
  /** The car's stamp card worth mentioning: a free wash waiting, or stamps that will reset. */
  reward?: { serviceName: string; free: number; stamps: number; every: number; expiresAt: string | null } | null;
}

function rewardLine(reward: NonNullable<ReminderInput['reward']>): string {
  const until = reward.expiresAt
    ? new Date(reward.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;
  if (reward.free > 0) {
    return `🎁 Your *free ${reward.serviceName}* is waiting${until ? ` — use it by ${until} or it expires` : ''}.`;
  }
  return `⭐ You have ${reward.stamps} of ${reward.every} stamps towards a *free ${reward.serviceName}*${until ? ` — they reset on ${until}, so come by before then` : ''}.`;
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
    ...(input.reward ? ['', rewardLine(input.reward)] : []),
    '',
    'See you soon!',
    `*Team ${SHOP.name}*`,
  ].join('\n');
}

export interface ReferralRewardInput {
  customerName: string | null | undefined;
  referredName: string | null | undefined;
  code: string;
  percent: number;
  expiresAt: string | Date;
}

/** Thanks a customer whose referral just paid for their first wash, with their reward code. */
export function buildReferralRewardMessage(input: ReferralRewardInput): string {
  const firstName = input.customerName?.trim().split(/\s+/)[0];
  const friend = input.referredName?.trim().split(/\s+/)[0];
  const expires = new Date(input.expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return [
    `Hi ${firstName || 'there'}! 👋`,
    '',
    `Thank you for sending ${friend ? `*${friend}*` : 'a friend'} to *${SHOP.name}* 🙌`,
    '',
    `As a thank-you, here’s *${input.percent}% off* your next wash 🎁`,
    '',
    `🎟️ Code: *${input.code}*`,
    `📅 Valid till *${expires}*`,
    '',
    '_Valid once, for any vehicle registered with us. Not combinable with other offers._',
    '',
    'Just show this message at the counter. See you soon!',
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
