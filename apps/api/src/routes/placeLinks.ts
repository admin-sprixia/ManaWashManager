import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import qrcode from 'qrcode-generator';
import { createPlatformDb, placeRepo } from '@mana/db';
import { describeWashDays, formatClock, isPlaceCode, parseWashDays, PLACE_TYPE_LABEL, type PlaceType } from '@mana/domain';
import { esc, openAppButton, page } from '../lib/pages';
import type { Env } from '../types';

/**
 * A place's invite link (`/p/<code>`, what the QR poster and a neighbour's "Join us" share) and
 * its printable poster. The link opens the Mana Wash app straight on that place.
 */

const codeParam = z.object({ code: z.string().toUpperCase() });

const notFound = () =>
  page('Mana Wash', `<main><div class="card"><h1>This place isn’t on Mana Wash</h1>
<p>Open the app to find washes near you.</p>${openAppButton('home')}</div></main>`);

/** The QR as an inline SVG (scales cleanly to any print size). */
function qrSvg(url: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

export const placeLinkRoutes = new Hono<{ Bindings: Env }>()
  .get('/:code', zValidator('param', codeParam), async (c) => {
    const code = c.req.valid('param').code;
    const found = isPlaceCode(code) ? await placeRepo.byCode(createPlatformDb(c.env.DB), code) : null;
    if (!found) return c.html(notFound(), 404);
    const { place } = found;
    const when = `${describeWashDays(parseWashDays(place.washDays))}, ${formatClock(place.washTime)}`;
    return c.html(
      page(
        `Car wash at ${place.label}`,
        `<main><div class="card"><p class="small">MANA WASH</p>
<h1>Car wash at ${esc(place.name ?? place.label)}</h1>
<p>${esc(place.name ? place.label : PLACE_TYPE_LABEL[place.type as PlaceType])}</p>
<p>Our team washes here on <b>${esc(when)}</b>. Join in a few seconds — pay online, no cash.</p>
${openAppButton(`place/${code}`, 'Join in the app')}
<p class="small">Place code: <b>${esc(code)}</b></p></div></main>`,
      ),
    );
  })
  .get('/:code/poster', zValidator('param', codeParam), async (c) => {
    const code = c.req.valid('param').code;
    const found = isPlaceCode(code) ? await placeRepo.byCode(createPlatformDb(c.env.DB), code) : null;
    if (!found) return c.html(notFound(), 404);
    const { place } = found;
    const url = `${new URL(c.req.url).origin}/p/${code}`;
    const when = `${describeWashDays(parseWashDays(place.washDays))} · ${formatClock(place.washTime)}`;
    return c.html(
      page(
        `Poster · ${place.label}`,
        `<main style="max-width:720px;text-align:center">
<p class="small" style="letter-spacing:.2em">MANA WASH</p>
<h1 style="font-size:40px;margin:8px 0">Car wash at your doorstep</h1>
<p style="font-size:22px;color:#0f172a"><b>${esc(place.name ?? place.label)}</b></p>
<p style="font-size:20px">Every <b>${esc(when)}</b></p>
<div style="width:62%;margin:24px auto">${qrSvg(url)}</div>
<p style="font-size:20px;color:#0f172a"><b>Scan with your phone camera to join</b></p>
<p style="font-size:16px">1. Scan &nbsp; 2. Pick your flat and vehicle &nbsp; 3. Pay online — no cash to the team</p>
<p style="font-size:16px">Or open the Mana Wash app and enter code <b style="letter-spacing:.15em">${esc(code)}</b></p>
<button class="btn primary noprint" style="max-width:280px;margin:24px auto" onclick="window.print()">Print poster</button>
</main>`,
        { print: true },
      ),
    );
  });
