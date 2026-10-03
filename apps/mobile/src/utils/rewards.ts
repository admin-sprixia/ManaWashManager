import { daysUntilReset, isRewardExpiringSoon, stampsToGo } from '@mana/domain';
import type { RewardCard } from '../offline/types';

/**
 * Cards still worth showing. A copy saved on this phone can outlive its card: past `expiresAt`
 * the car skipped the service too long and the server has already reset it.
 */
export function liveCards(cards: readonly RewardCard[] | undefined, now = new Date()): RewardCard[] {
  return (cards ?? []).filter(
    (c) => (c.stamps > 0 || c.free > 0) && (!c.expiresAt || Date.parse(c.expiresAt) > now.getTime()),
  );
}

function expiryOf(card: RewardCard): { expiresAt: Date | null } {
  return { expiresAt: card.expiresAt ? new Date(card.expiresAt) : null };
}

/** Whole days until the card resets; null when there's nothing on it to lose. */
export function cardDaysLeft(card: RewardCard, now = new Date()): number | null {
  return daysUntilReset(expiryOf(card), now);
}

export function cardExpiringSoon(card: RewardCard, now = new Date()): boolean {
  return isRewardExpiringSoon(expiryOf(card), now);
}

/** "today", "in 1 day", "in 9 days". */
export function daysLabel(days: number): string {
  if (days <= 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** What staff read under a card: "2 more for a free one" / "Free wash ready". */
export function cardProgressLabel(card: RewardCard): string {
  if (card.free > 0) {
    const more = card.stamps > 0 ? ` · ${card.stamps}/${card.every} towards the next` : '';
    return `${card.free === 1 ? 'Free wash ready' : `${card.free} free washes ready`}${more}`;
  }
  const left = stampsToGo(card.every, card);
  return `${card.stamps}/${card.every} · ${left} more for a free one`;
}

/** The expiry warning: "Free wash expires in 4 days" / "Stamps reset in 4 days". */
export function cardExpiryWarning(card: RewardCard, now = new Date()): string | null {
  if (!cardExpiringSoon(card, now)) return null;
  const days = cardDaysLeft(card, now) ?? 0;
  return `${card.free > 0 ? (card.free === 1 ? 'Free wash expires' : 'Free washes expire') : 'Stamps reset'} ${daysLabel(days)}`;
}

/** "Microfibre cloth × 2" — a gift line in its stock unit. */
export function giftLine(item: { itemName?: string; name?: string; quantity: number; unit: string }): string {
  const name = item.itemName ?? item.name ?? 'Item';
  if (item.unit === 'pcs') return item.quantity === 1 ? name : `${name} × ${item.quantity}`;
  return `${name} · ${item.quantity} ${item.unit}`;
}
