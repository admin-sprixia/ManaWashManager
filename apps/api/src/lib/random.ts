import { pickCouponPercent } from '@mana/domain';

/** CSPRNG bytes from Web Crypto — the only randomness coupons and referrals ever use. */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** A uniformly random string of digits (rejection sampling, so no digit is more likely). */
export function randomDigits(length: number): string {
  const range = 10 ** length;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  for (;;) {
    const [a = 0, b = 0, c = 0, d = 0] = randomBytes(4);
    const n = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    if (n < limit) return String(n % range).padStart(length, '0');
  }
}

/** A uniformly random whole coupon percentage (see `pickCouponPercent`). */
export function drawPercent(): number {
  for (;;) {
    const percent = pickCouponPercent(randomBytes(8));
    if (percent != null) return percent;
  }
}
