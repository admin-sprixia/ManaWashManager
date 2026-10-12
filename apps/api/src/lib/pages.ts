/**
 * Small server-rendered pages people open in a browser: the payment return and test checkout,
 * a place's invite link and its printable QR poster. Plain HTML with inline styles, no scripts
 * beyond opening the app, so they load fast on any phone.
 */

export const APP_SCHEME = 'manacarwash://';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sprixia.manacarwash';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put inside HTML (and attribute values). */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

export function page(title: string, body: string, options: { print?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { --brand: #0b5cff; --ink: #0f172a; --muted: #64748b; --ok: #15803d; --bad: #b91c1c; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, system-ui, Roboto, "Segoe UI", sans-serif; color: var(--ink); background: ${options.print ? '#fff' : '#f1f5f9'}; }
  main { max-width: 440px; margin: 0 auto; padding: 32px 20px; }
  .card { background: #fff; border-radius: 20px; padding: 28px 22px; box-shadow: 0 1px 3px rgba(15,23,42,.08); text-align: center; }
  h1 { font-size: 22px; margin: 12px 0 8px; }
  p { color: var(--muted); line-height: 1.5; margin: 8px 0; }
  .amount { font-size: 34px; font-weight: 800; margin: 12px 0; color: var(--ink); }
  .btn { display: block; width: 100%; padding: 15px; border-radius: 14px; border: 0; font-size: 16px; font-weight: 700; text-decoration: none; margin-top: 12px; cursor: pointer; }
  .primary { background: var(--brand); color: #fff; }
  .ghost { background: #e2e8f0; color: var(--ink); }
  .danger { background: #fee2e2; color: var(--bad); }
  .badge { display: inline-block; width: 64px; height: 64px; border-radius: 32px; line-height: 64px; font-size: 32px; }
  .ok { background: #dcfce7; color: var(--ok); }
  .bad { background: #fee2e2; color: var(--bad); }
  .wait { background: #e0e7ff; color: var(--brand); }
  .small { font-size: 13px; }
  @media print { body { background: #fff; } .noprint { display: none; } }
</style>
</head>
<body>${body}</body>
</html>`;
}

/** A page whose main button opens the app at `path` (falls back to the Play Store). */
export function openAppButton(path: string, label = 'Open MANA Car Wash'): string {
  return `<a class="btn primary" href="${esc(APP_SCHEME + path)}">${esc(label)}</a>
<a class="btn ghost small" href="${esc(PLAY_STORE_URL)}">Don’t have the app? Get it on Google Play</a>`;
}
