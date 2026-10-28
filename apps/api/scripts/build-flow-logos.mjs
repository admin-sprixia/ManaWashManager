// The company logos the WhatsApp Flow shows next to each company: every logo in the app's
// packages/ui/src/makeLogos.ts, shrunk to a 96 × 72 PNG and base64'd into
// src/assets/make-logos.json (bundled into the worker). Run again after adding a logo there.
//   node scripts/build-flow-logos.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const UI = new URL('../../../packages/ui/src/', import.meta.url);
const source = readFileSync(new URL('makeLogos.ts', UI), 'utf8');
const entries = [...source.matchAll(/^\s*(?:'([^']+)'|([\p{L}\p{N}]+)):\s*require\('(\.\/assets\/makes\/[^']+)'\)/gmu)].map((m) => [m[1] ?? m[2], m[3]]);

const out = {};
let bytes = 0;
for (const [make, file] of entries) {
  const png = await sharp(fileURLToPath(new URL(file, UI)))
    .resize(96, 72, { fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  out[make] = png.toString('base64');
  bytes += png.length;
}
writeFileSync(new URL('../src/assets/make-logos.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`${entries.length} logos, ${Math.round(bytes / 1024)} KB`);
