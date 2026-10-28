import { Hono } from 'hono';
import { page } from '../lib/pages';
import type { Env } from '../types';

/**
 * The privacy policy and data-deletion page, public: Meta asks for both before the WhatsApp app is
 * published, and the Play Store listings link the policy.
 */

const CONTACT = 'support@sprixia.com';
const UPDATED = '28 October 2026';

const DOC_STYLE = `<style>
  .doc { background: #fff; border-radius: 20px; padding: 28px 22px; box-shadow: 0 1px 3px rgba(15,23,42,.08); }
  .doc h1 { margin-top: 0; }
  .doc h2 { font-size: 17px; margin: 22px 0 6px; }
  .doc p, .doc li { color: #334155; line-height: 1.6; font-size: 15px; }
  .doc ul { padding-left: 20px; margin: 6px 0; }
  main { max-width: 720px; }
</style>`;

const doc = (title: string, html: string) => page(title, `${DOC_STYLE}<main><article class="doc">${html}</article></main>`);

const PRIVACY = doc(
  'Privacy policy',
  `<h1>Privacy policy</h1>
<p class="small">Sri Mana Wash and the Mana Wash apps · Last updated ${UPDATED}</p>
<p>Sri Mana Wash is a car and bike wash in Kovur, SPSR Nellore District, Andhra Pradesh, run with
software from Sprixia Labs Private Limited ("we"). This policy explains what we collect when you
wash with us, use the Mana Wash or Mana Wash Partner apps, or message us on WhatsApp, and what we
do with it.</p>

<h2>What we collect</h2>
<ul>
  <li><b>Contact details:</b> your name and mobile number.</li>
  <li><b>Vehicles:</b> registration number, make and model, and kind of vehicle.</li>
  <li><b>Washes and payments:</b> services, prices, discounts, how you paid, dates, and photos of
    your vehicle taken before and after a wash.</li>
  <li><b>WhatsApp messages:</b> messages you send to our business number and the replies, bills
    and reminders we send, with their delivery status, and the name on your WhatsApp profile.</li>
  <li><b>Location:</b> only if you share it, to find a nearby branch or wash at your home or
    community.</li>
  <li><b>Team members:</b> name, mobile number, attendance and the work they record in the app.</li>
</ul>

<h2>How we use it</h2>
<ul>
  <li>To wash your vehicle, show prices for your model, keep your bill, plans and rewards.</li>
  <li>To send you messages about your wash on WhatsApp: prices you ask for, "ready for pickup",
    bills and thank-yous.</li>
  <li>To send occasional offers and wash reminders. Reply <b>STOP</b> on WhatsApp any time to
    stop them (bills and pickup messages still come); reply <b>START</b> to get them again.</li>
  <li>To sign you in with a one-time code on WhatsApp.</li>
  <li>To run the business: daily reports, cash and stock records.</li>
</ul>
<p>We don't sell your data and don't use it for advertising by anyone else.</p>

<h2>Who else handles it</h2>
<ul>
  <li><b>Meta (WhatsApp Business Platform)</b>, which carries our WhatsApp messages.</li>
  <li><b>Cloudflare</b>, which hosts our servers, database and photos.</li>
  <li><b>Razorpay</b>, if you pay online, which processes the payment.</li>
</ul>
<p>Each handles data only to provide its service to us. We share data with authorities only when
the law requires it.</p>

<h2>How long we keep it</h2>
<p>Vehicle photos are deleted 90 days after the wash. Wash, bill and payment records are kept as
long as the law requires for accounts and tax. Other details are kept while you're our customer
and deleted on request.</p>

<h2>Your choices</h2>
<p>You can ask to see, correct or delete your details. See
<a href="/legal/data-deletion">how to delete your data</a>, or write to
<a href="mailto:${CONTACT}">${CONTACT}</a>.</p>

<h2>Security</h2>
<p>Data travels encrypted (HTTPS), each branch sees only its own records, and team members sign in
with a one-time code and a personal PIN.</p>

<h2>Contact</h2>
<p>Sri Mana Wash, Door No 1-0, Near Highway, Sai Baba Temple, Kovur, SPSR Nellore District,
Andhra Pradesh 524137 · <a href="mailto:${CONTACT}">${CONTACT}</a></p>`,
);

const DATA_DELETION = doc(
  'Delete your data',
  `<h1>Delete your data</h1>
<p class="small">Sri Mana Wash and the Mana Wash apps · Last updated ${UPDATED}</p>
<p>You can ask us to delete the details we hold about you: your name, number, vehicles, photos,
WhatsApp messages and app account.</p>
<h2>How to ask</h2>
<ul>
  <li>In the <b>Mana Wash app</b>: Profile → <b>Delete app account</b> removes your app sign-in
    straight away. To remove your wash records too, ask as below.</li>
  <li>Email <a href="mailto:${CONTACT}">${CONTACT}</a> from any address, with the mobile number
    you use with us and the words "Delete my data".</li>
  <li>Or tell the team at the branch.</li>
</ul>
<h2>What happens</h2>
<p>We confirm it's your number, then delete your details within 30 days and tell you when it's
done. Bills and payment records the law requires us to keep for accounts and tax are kept for
that period only, without being used for anything else.</p>
<p><a href="/legal/privacy">Read our privacy policy</a></p>`,
);

export const legalRoutes = new Hono<{ Bindings: Env }>()
  .get('/privacy', (c) => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.html(PRIVACY);
  })
  .get('/data-deletion', (c) => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.html(DATA_DELETION);
  });
