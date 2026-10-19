/** Sites a Google review link can be on: Google's own short links and google.com / google.co.in. */
const GOOGLE_REVIEW_HOSTS = ['g.page', 'goo.gl', 'maps.app.goo.gl', 'g.co', 'google.com', 'google.co.in'];

/** The site of an https link ("https://g.page/r/abc" → "g.page"), or null when it isn't one. */
export function httpsHost(url: string): string | null {
  const match = /^https:\/\/([^/?#\s:@]+)(?::\d+)?(?:[/?#]\S*)?$/i.exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * True for a Google review link: https on one of Google's sites (or a subdomain, like
 * search.google.com). The link goes to customers on WhatsApp, so nothing else is accepted.
 */
export function isGoogleReviewUrl(url: string): boolean {
  const host = httpsHost(url);
  if (!host) return false;
  return GOOGLE_REVIEW_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
