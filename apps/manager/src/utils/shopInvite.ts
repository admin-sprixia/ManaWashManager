import { Share } from 'react-native';
import { formatShopCode } from '@mana/domain';
import type { ShopInfo } from '../offline/ShopProvider';

/** What a new teammate needs to ask to join: the app, their own number, and the branch ID. */
export function shopInviteMessage(shop: ShopInfo): string {
  return (
    `Join ${shop.name} on Mana Wash Partner:\n` +
    `1. Open the app and enter your mobile number\n` +
    `2. Enter branch ID ${formatShopCode(shop.code)}\n` +
    `I’ll approve you from my phone.`
  );
}

export function shareShopInvite(shop: ShopInfo): void {
  Share.share({ message: shopInviteMessage(shop) }).catch(() => undefined);
}
