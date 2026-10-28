// The WhatsApp profile photo of the business number: the glass drop filling the circle WhatsApp
// crops it to, on the brand's indigo, so it reads at the size of a chat-list icon.
//   node branding/sri-mana-wash-logo/build-whatsapp-profile.mjs → whatsapp-profile.jpg (1080 × 1080)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZE = 1080;
// WhatsApp shows the middle circle; the drop (trimmed of the mark file's margin) fills about 80% of
// its height, centred optically (its soft shadow sits below it, so the whole is nudged down a little).
const DROP_H = Math.round(SIZE * 0.8);

const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
<defs>
  <radialGradient id="g" cx="0.5" cy="0.38" r="0.7">
    <stop offset="0" stop-color="#3A4DB0"/><stop offset="0.55" stop-color="#1B2878"/><stop offset="1" stop-color="#0C1442"/>
  </radialGradient>
</defs>
<rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
</svg>`;

const trimmed = await sharp(join(HERE, 'sri-mana-wash-mark.png')).trim({ threshold: 1 }).toBuffer();
const drop = await sharp(trimmed).resize({ height: DROP_H }).toBuffer();
const { width } = await sharp(drop).metadata();
await sharp(Buffer.from(bg))
  .composite([{ input: drop, left: Math.round((SIZE - width) / 2), top: Math.round((SIZE - DROP_H) / 2 + SIZE * 0.02) }])
  .jpeg({ quality: 92 })
  .toFile(join(HERE, 'whatsapp-profile.jpg'));
console.log('wrote whatsapp-profile.jpg');
