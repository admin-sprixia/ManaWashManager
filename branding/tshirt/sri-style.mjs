// శ్రీ in the devotional-poster style: a bright yellow-to-orange fill, a thick dark-maroon border with an
// orange one inside it, a 3D bevel (light top-left edge, deep bottom-right edge), a gloss over the top
// and a soft drop shadow. Plain SVG (paths, gradients, one blur), so it prints the same everywhere.

const n = (v) => String(Math.round(v * 100) / 100);

/** The gradients and filter the style needs; add once to <defs>. */
export const SRI_DEFS = `
<linearGradient id="sri-fill" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF7A1"/><stop offset="0.3" stop-color="#FFE14A"/>
  <stop offset="0.62" stop-color="#FFB524"/><stop offset="1" stop-color="#F06A0E"/>
</linearGradient>
<linearGradient id="sri-gloss" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/><stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.12"/>
  <stop offset="0.46" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<filter id="sri-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>`;

/**
 * The styled glyph. `d` is the outlined glyph (baseline at 0), `top` the ink's top, `x`/`y` where
 * that ink's top-left goes, `height` its height; `uid` keeps clip ids apart when drawn more than once.
 * `flat` drops the gradients and blur for screen printing (solid gold, maroon border).
 */
export function styledSri({ d, top, bottom, x, y, height, uid, flat = false }) {
  const k = height / (bottom - top);
  const at = `transform="translate(${n(x)} ${n(y - top * k)}) scale(${n(k)})"`;
  const u = (px) => n(px / k); // a stroke width in output units, as glyph units
  const h = height;
  if (flat) {
    return (
      `<path d="${d}" ${at} fill="#5A1500" stroke="#5A1500" stroke-width="${u(h * 0.05)}" stroke-linejoin="round"/>` +
      `<path d="${d}" ${at} fill="#F7A51C"/>`
    );
  }
  const clip = `sri-clip-${uid}`;
  const shift = (dx, dy) => `transform="translate(${n(x + dx)} ${n(y + dy - top * k)}) scale(${n(k)})"`;
  return `
<clipPath id="${clip}"><path d="${d}" ${at}/></clipPath>
<path d="${d}" ${shift(h * 0.025, h * 0.035)} fill="#2A0A00" fill-opacity="0.55" stroke="#2A0A00" stroke-opacity="0.55" stroke-width="${u(h * 0.06)}" stroke-linejoin="round" filter="url(#sri-shadow)"/>
<path d="${d}" ${at} fill="#5A1500" stroke="#5A1500" stroke-width="${u(h * 0.062)}" stroke-linejoin="round"/>
<path d="${d}" ${at} fill="#D9480F" stroke="#D9480F" stroke-width="${u(h * 0.026)}" stroke-linejoin="round"/>
<path d="${d}" ${at} fill="url(#sri-fill)"/>
<g clip-path="url(#${clip})">
  <path d="${d}" ${shift(h * 0.012, h * 0.016)} fill="none" stroke="#B4400A" stroke-opacity="0.85" stroke-width="${u(h * 0.03)}" stroke-linejoin="round"/>
  <path d="${d}" ${shift(-h * 0.008, -h * 0.011)} fill="none" stroke="#FFFBE0" stroke-opacity="0.9" stroke-width="${u(h * 0.018)}" stroke-linejoin="round"/>
  <path d="${d}" ${at} fill="url(#sri-gloss)"/>
</g>`;
}
