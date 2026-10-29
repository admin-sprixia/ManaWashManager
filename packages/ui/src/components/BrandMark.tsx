import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { BRAND_MARK, BRAND_MARK_BOX } from '@mana/domain';
import { colors } from '../theme';

// The shapes live in @mana/domain so the server can draw them too (the PDF bill).
export { BRAND_MARK, BRAND_MARK_BOX, BRAND_SRI, BRAND_SRI_GOLD } from '@mana/domain';

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
