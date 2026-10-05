import { Share } from 'react-native';
import { formatShopCode } from '@mana/domain';
import type { ShopInfo } from '../offline/ShopProvider';

/** What a new teammate needs to ask to join: the app, their own number, and the shop ID. */
export function shopInviteMessage(shop: ShopInfo): string {
  return (
    `Join ${shop.name} on MANA Wash Manager:\n` +
    `1. Open the app and enter your mobile number\n` +
    `2. Tap “I work at a shop”\n` +
    `3. Enter shop ID ${formatShopCode(shop.code)}\n` +
    `I’ll approve you from my phone.`
  );
}

export function shareShopInvite(shop: ShopInfo): void {
  Share.share({ message: shopInviteMessage(shop) }).catch(() => undefined);
}
