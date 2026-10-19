import { describe, expect, it } from 'vitest';
import { httpsHost, isGoogleReviewUrl } from '../shopSettings';

describe('Google review links', () => {
  it('accepts the links Google gives out', () => {
    expect(isGoogleReviewUrl('https://g.page/r/CdAbc123/review')).toBe(true);
    expect(isGoogleReviewUrl('https://maps.app.goo.gl/AbC1')).toBe(true);
    expect(isGoogleReviewUrl('https://search.google.com/local/writereview?placeid=ChIJ')).toBe(true);
    expect(isGoogleReviewUrl('https://www.google.co.in/maps/place/Mana')).toBe(true);
    expect(isGoogleReviewUrl('  https://G.PAGE/r/x  ')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isGoogleReviewUrl('http://g.page/r/x')).toBe(false);
    expect(isGoogleReviewUrl('https://google.evil.com/review')).toBe(false);
    expect(isGoogleReviewUrl('https://notgoogle.com/x')).toBe(false);
    expect(isGoogleReviewUrl('https://g.page.evil.in/x')).toBe(false);
    expect(isGoogleReviewUrl('https://user@g.page/x')).toBe(false);
    expect(isGoogleReviewUrl('https://g.page/r/a b')).toBe(false);
    expect(isGoogleReviewUrl('g.page/r/x')).toBe(false);
  });

  it('reads the site of a link', () => {
    expect(httpsHost('https://maps.app.goo.gl/x?y=1')).toBe('maps.app.goo.gl');
    expect(httpsHost('https://g.page:443/r')).toBe('g.page');
    expect(httpsHost('ftp://g.page')).toBeNull();
  });
});
