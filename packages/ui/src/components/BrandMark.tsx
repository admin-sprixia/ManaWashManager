import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../theme';

/** The MANA mark's three shapes, in a 256 box: the drop, the arms along its lower edge, and the centre drop. */
export const BRAND_MARK = {
  drop: 'M128 14C128 14 212 96 212 158A84 84 0 0 1 44 158C44 96 128 14 128 14Z',
  arms: 'M80.37 80C63.69 104.42 49.04 133.01 49.04 158.12A78.96 78.96 0 0 0 206.96 158.12C206.96 133.01 192.31 104.42 175.63 80L175.63 80C168.96 101.53 189.32 132.46 189.32 158.54A61.32 61.32 0 0 1 66.68 158.54C66.68 132.46 87.04 101.53 80.37 80Z',
  centre: 'M128 56C128 56 118 128 118 166A10 10 0 0 0 138 166C138 128 128 56 128 56Z',
} as const;

export const BRAND_MARK_BOX = 256;

/**
 * శ్రీ (Sri, in Telugu), as it stands above MANA on the printed card: outlined from Telugu Sangam MN
 * bold at a 100-unit em (branding/card/outline-text.py), so it draws the same on every phone with no
 * Telugu font needed. `viewBox` is its ink box; colour it with BRAND_SRI_GOLD.
 */
export const BRAND_SRI = {
  d: 'M61.58 -57.74Q61.58 -51.89 59.5 -47.08Q57.42 -42.26 54.26 -38.21Q58.74 -34.89 61.16 -30.47Q63.58 -26.05 63.58 -21.11Q63.58 -16.21 61.45 -12.29Q59.32 -8.37 55.76 -5.66Q52.21 -2.95 47.66 -1.47Q43.11 0 38.32 0Q34.42 0 31.16 -1.13Q27.89 -2.26 25.5 -4.26Q23.11 -6.26 21.76 -8.97Q20.42 -11.68 20.42 -14.79Q20.42 -17.84 21.53 -20.37Q22.63 -22.89 24.45 -25.16Q26.26 -27.42 28.63 -29.47Q31 -31.53 33.53 -33.58L35.68 -35.37Q33.16 -35.84 30.47 -35.84Q28.37 -35.84 25.92 -35.42Q23.47 -35 21.39 -33.95Q19.32 -32.89 17.92 -31.11Q16.53 -29.32 16.53 -26.63Q16.53 -26.42 16.55 -26.21Q16.58 -26 16.58 -25.79Q15.63 -25.68 14.63 -25.47Q13.74 -25.32 12.63 -25.13Q11.53 -24.95 10.37 -24.79Q7.63 -24.32 4.11 -23.79Q3.84 -24.79 3.76 -25.71Q3.68 -26.63 3.68 -27.53Q3.68 -31.95 6.11 -35.26Q8.53 -38.58 12.39 -40.79Q16.26 -43 21.03 -44.11Q25.79 -45.21 30.47 -45.21Q34.16 -45.21 37.53 -44.71Q40.89 -44.21 43.89 -43.32Q46.26 -46.32 47.71 -49.79Q49.16 -53.26 49.16 -57.74Q49.16 -61.53 48.37 -64.84Q47.58 -68.16 46.26 -70.89Q45.58 -68.89 44.11 -66.89Q42.63 -64.89 40.58 -63.32Q38.53 -61.74 36.05 -60.76Q33.58 -59.79 30.84 -59.79Q26.84 -59.79 23.61 -60.97Q20.37 -62.16 18.08 -64.21Q15.79 -66.26 14.55 -69.03Q13.32 -71.79 13.32 -75Q13.32 -77.84 14.47 -80.68Q15.63 -83.53 18.03 -85.82Q20.42 -88.11 24.13 -89.53Q27.84 -90.95 32.95 -90.95Q36 -90.95 39.32 -89.97Q42.63 -89 45.82 -87.11Q49 -85.21 51.87 -82.39Q54.74 -79.58 56.89 -75.87Q59.05 -72.16 60.32 -67.63Q61.58 -63.11 61.58 -57.74ZM32.95 -14.79Q32.95 -12.47 34.68 -11.03Q36.42 -9.58 39.37 -9.58Q42.11 -9.58 44.26 -10.55Q46.42 -11.53 47.92 -13.16Q49.42 -14.79 50.24 -16.87Q51.05 -18.95 51.05 -21.11Q51.05 -24 49.95 -26.29Q48.84 -28.58 46.95 -30.32Q44.32 -27.84 41.79 -25.68Q39.26 -23.53 37.29 -21.63Q35.32 -19.74 34.13 -18.03Q32.95 -16.32 32.95 -14.79ZM32.95 -81.26Q31.16 -81.26 29.61 -80.76Q28.05 -80.26 26.92 -79.32Q25.79 -78.37 25.16 -77.03Q24.53 -75.68 24.53 -74.05Q24.53 -72.37 25.21 -71.21Q25.89 -70.05 26.92 -69.32Q27.95 -68.58 29.16 -68.26Q30.37 -67.95 31.42 -67.95Q33.16 -67.95 34.71 -68.68Q36.26 -69.42 37.55 -70.74Q38.84 -72.05 39.79 -73.84Q40.74 -75.63 41.21 -77.68Q39.26 -79.42 37.16 -80.34Q35.05 -81.26 32.95 -81.26ZM31.26 -86.16Q30.37 -88.26 29.95 -90.29Q29.53 -92.32 29.53 -94.16Q29.53 -97.42 30.71 -100.18Q31.89 -102.95 33.95 -104.95Q36 -106.95 38.79 -108.05Q41.58 -109.16 44.79 -109.16Q47.11 -109.16 49.47 -108.63Q51.84 -108.11 54.16 -106.76Q56.47 -105.42 58.68 -103.13Q60.89 -100.84 62.89 -97.26L55.16 -92.32Q53.16 -96.11 50.97 -98.16Q48.79 -100.21 45.84 -100.21Q44.21 -100.21 42.87 -99.58Q41.53 -98.95 40.55 -97.82Q39.58 -96.68 39.03 -95.13Q38.47 -93.58 38.47 -91.79Q38.47 -90.47 38.76 -89.05Q39.05 -87.63 39.74 -86.16ZM38.42 36.63Q33.26 36.63 28.55 35.68Q23.84 34.74 19.55 32.5Q15.26 30.26 11.29 26.61Q7.32 22.95 3.58 17.58L11.11 10.89Q13.95 15.21 17.08 18.26Q20.21 21.32 23.61 23.26Q27 25.21 30.71 26.11Q34.42 27 38.42 27Q42.42 27 46.13 26.11Q49.84 25.21 53.26 23.26Q56.68 21.32 59.82 18.26Q62.95 15.21 65.79 10.89L73.32 17.58Q69.58 22.95 65.61 26.61Q61.63 30.26 57.32 32.5Q53 34.74 48.29 35.68Q43.58 36.63 38.42 36.63Z',
  viewBox: '3.58 -109.16 69.74 145.79',
  /** Ink width ÷ height, to size it from a height. */
  aspect: 69.74 / 145.79,
} as const;

/** The card's gandham (sandalwood paste) gold for శ్రీ: light, mid, deep. */
export const BRAND_SRI_GOLD = ['#F8E2B0', '#E8BF78', '#CF9C52'] as const;

interface BrandMarkProps {
  size?: number;
  /** 'glass': an indigo glass drop with white arms and centre (for light surfaces).
   *  'onDark': a white drop with indigo arms and centre (for the gradient hero).
   *  'ghost': three translucent whites, for use as a watermark. */
  variant?: 'glass' | 'onDark' | 'ghost';
}

/** The logo mark as an SVG, drawn from the same shapes as the app icon. */
export function BrandMark({ size = 28, variant = 'glass' }: BrandMarkProps) {
  const gid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = `mark${gid}`;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BRAND_MARK_BOX} ${BRAND_MARK_BOX}`}>
      {variant === 'glass' ? (
        <Defs>
          <LinearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#9BAEF5" />
            <Stop offset="0.45" stopColor="#4458CC" />
            <Stop offset="1" stopColor={colors.indigoDeep} />
          </LinearGradient>
        </Defs>
      ) : null}
      {variant === 'ghost' ? (
        <>
          <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.09} />
          <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.13} />
          <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.2} />
        </>
      ) : (
        <>
          <Path d={BRAND_MARK.drop} fill={variant === 'glass' ? `url(#${id})` : '#FFFFFF'} />
          <Path d={BRAND_MARK.arms} fill={variant === 'glass' ? '#FFFFFF' : '#4458CC'} />
          <Path d={BRAND_MARK.centre} fill={variant === 'glass' ? '#FFFFFF' : '#4458CC'} />
        </>
      )}
    </Svg>
  );
}
