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
  return qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
}

/** The Mana Wash drop, white, for the poster's header (same shapes as the app's BrandMark). */
const MARK = `<svg viewBox="0 0 256 256" width="56" height="56" aria-hidden="true">
<path d="M128 14C128 14 212 96 212 158A84 84 0 0 1 44 158C44 96 128 14 128 14Z" fill="#fff"/>
<path d="M80.37 80C63.69 104.42 49.04 133.01 49.04 158.12A78.96 78.96 0 0 0 206.96 158.12C206.96 133.01 192.31 104.42 175.63 80L175.63 80C168.96 101.53 189.32 132.46 189.32 158.54A61.32 61.32 0 0 1 66.68 158.54C66.68 132.46 87.04 101.53 80.37 80Z" fill="#4458CC"/>
<path d="M128 56C128 56 118 128 118 166A10 10 0 0 0 138 166C138 128 128 56 128 56Z" fill="#4458CC"/></svg>`;

/** A4 poster for a lift or notice board: who we are, when we wash, and the QR to join. */
function posterHtml(p: { title: string; subtitle: string; when: string; code: string; url: string }): string {
  return `<style>
  @page { size: A4; margin: 0; }
  html, body { background: #e2e8f0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; min-height: 297mm; margin: 24px auto; background: #fff; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(12,20,66,.18); overflow: hidden; }
  .top { background: linear-gradient(160deg, #4458CC 0%, #1B2878 55%, #0C1442 100%); color: #fff; padding: 18mm 16mm 26mm; position: relative; text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .brand b { font-size: 26px; letter-spacing: .32em; font-weight: 800; }
  .top h1 { font-size: 46px; line-height: 1.08; margin: 12mm 0 4mm; letter-spacing: -.02em; color: #fff; }
  .top .place { font-size: 26px; font-weight: 800; color: #fff; margin: 0; }
  .top .sub { font-size: 17px; color: rgba(255,255,255,.78); margin: 2mm 0 0; }
  .when { display: inline-block; margin-top: 7mm; background: rgba(255,255,255,.14); border: 1.5px solid rgba(255,255,255,.35); color: #fff; font-size: 20px; font-weight: 800; padding: 10px 22px; border-radius: 999px; }
  .qrwrap { margin: -16mm auto 0; position: relative; background: #fff; width: 98mm; padding: 9mm; border-radius: 9mm; box-shadow: 0 8px 30px rgba(12,20,66,.18); }
  .qrwrap svg { display: block; width: 100%; height: auto; }
  .corner { position: absolute; width: 14mm; height: 14mm; border: 2.2mm solid #0EA5E9; }
  .c1 { top: 3mm; left: 3mm; border-right: 0; border-bottom: 0; border-radius: 4mm 0 0 0; }
  .c2 { top: 3mm; right: 3mm; border-left: 0; border-bottom: 0; border-radius: 0 4mm 0 0; }
  .c3 { bottom: 3mm; left: 3mm; border-right: 0; border-top: 0; border-radius: 0 0 0 4mm; }
  .c4 { bottom: 3mm; right: 3mm; border-left: 0; border-top: 0; border-radius: 0 0 4mm 0; }
  .scan { text-align: center; font-size: 24px; font-weight: 800; color: #0C1442; margin: 7mm 0 0; }
  .steps { display: flex; gap: 6mm; padding: 9mm 16mm 0; }
  .step { flex: 1; text-align: center; }
  .num { width: 12mm; height: 12mm; border-radius: 50%; background: #E8ECFF; color: #4458CC; font-weight: 800; font-size: 20px; line-height: 12mm; margin: 0 auto 3mm; }
  .step b { display: block; font-size: 17px; color: #0C1442; }
  .step span { font-size: 14px; color: #64748b; }
  .code { margin: 9mm 16mm 0; padding: 6mm; border-radius: 6mm; background: #F4F6FF; border: 1.5px dashed #9BAEF5; text-align: center; }
  .code p { margin: 0; font-size: 15px; color: #475569; }
  .code strong { display: block; font-size: 34px; letter-spacing: .3em; color: #0C1442; margin-top: 2mm; }
  .foot { margin-top: auto; padding: 8mm 16mm; display: flex; justify-content: center; gap: 10mm; font-size: 14px; color: #475569; font-weight: 700; }
  .foot i { font-style: normal; color: #0EA5E9; margin-right: 6px; }
  .print { display: block; max-width: 280px; margin: 0 auto 32px; }
  @media print { html, body { background: #fff; } .sheet { margin: 0; box-shadow: none; } .noprint { display: none; } }
</style>
<div class="sheet">
  <div class="top">
    <div class="brand">${MARK}<b>MANA WASH</b></div>
    <h1>Car wash at your doorstep</h1>
    <p class="place">${esc(p.title)}</p>
    ${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ''}
    <div class="when">${esc(p.when)}</div>
  </div>
  <div class="qrwrap"><span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>${qrSvg(p.url)}</div>
  <p class="scan">Scan with your phone camera to join</p>
  <div class="steps">
    <div class="step"><div class="num">1</div><b>Scan</b><span>Opens the Mana Wash app</span></div>
    <div class="step"><div class="num">2</div><b>Pick your flat</b><span>And add your vehicle</span></div>
    <div class="step"><div class="num">3</div><b>Pay online</b><span>No cash to the team</span></div>
  </div>
  <div class="code"><p>No camera? Open the Mana Wash app and enter this code</p><strong>${esc(p.code)}</strong></div>
  <div class="foot"><span><i>●</i>Washed at your parking spot</span><span><i>●</i>Pay safely online</span></div>
</div>
<button class="btn primary noprint print" onclick="window.print()">Print poster</button>`;
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
        posterHtml({ title: place.name ?? place.label, subtitle: place.name ? place.label : '', when, code, url }),
        { print: true },
      ),
    );
  });
