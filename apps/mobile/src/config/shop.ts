/**
 * Customer-facing shop details used in WhatsApp messages, PDFs and greetings. The name follows
 * the signed-in shop (ShopProvider keeps it current and cached offline); the Google review link
 * is set by the owner in Settings and synced to every phone.
 */
const FALLBACK_NAME = 'Car Wash';

let currentName = FALLBACK_NAME;

export const SHOP = {
  get name(): string {
    return currentName;
  },
};

export function setShopName(name: string | null | undefined): void {
  currentName = name?.trim() || FALLBACK_NAME;
}
