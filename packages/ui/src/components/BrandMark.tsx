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
