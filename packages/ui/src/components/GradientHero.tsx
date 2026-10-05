import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { brandGradients, radius } from '../theme';
import { BRAND_MARK } from './BrandMark';

interface GradientHeroProps extends PropsWithChildren {
  /** Extra height beyond the safe-area top inset. Omit to size from content. */
  height?: number;
}

/** [x, y, radius, opacity] in a 390 × 230 box. */
const STARS = [
  [40, 70, 1.6, 0.6],
  [96, 40, 1.1, 0.5],
  [160, 96, 1.3, 0.4],
  [250, 44, 1.8, 0.7],
  [318, 102, 1.2, 0.5],
  [356, 40, 1.4, 0.6],
  [210, 150, 1, 0.4],
  [70, 170, 1.2, 0.35],
] as const;

/** The light, faint stars and the logo watermark behind a hero's content. Measured, so the glows
 * keep their shape at any width and height. */
function HeroDecor() {
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const { w, h } = box;
  // The stars and watermark are drawn in a 390 × 230 box and scaled to cover the hero (like CSS "cover").
  const s = Math.max(w / 390, h / 230);
  const ox = (w - 390 * s) / 2;
  const oy = (h - 230 * s) / 2;
  // A glow's radius is a fraction of the distance to the far corner.
  const r1 = 0.52 * Math.hypot(0.88 * w, 1.06 * h);
  const r2 = 0.5 * Math.hypot(w, 1.05 * h);

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient id="heroGlowA" gradientUnits="userSpaceOnUse" cx={0.88 * w} cy={-0.06 * h} r={r1}>
              <Stop offset="0" stopColor="#9BAEF5" stopOpacity={0.65} />
              <Stop offset="1" stopColor="#9BAEF5" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="heroGlowB" gradientUnits="userSpaceOnUse" cx={0} cy={1.05 * h} r={r2}>
              <Stop offset="0" stopColor="#5468D4" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#5468D4" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill="url(#heroGlowA)" />
          <Rect x={0} y={0} width={w} height={h} fill="url(#heroGlowB)" />
          <G transform={`translate(${ox} ${oy}) scale(${s})`}>
            {STARS.map(([x, y, r, o]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
            ))}
            <G transform="translate(236 40) scale(0.78)">
              <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.09} />
              <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.13} />
              <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.2} />
            </G>
          </G>
        </Svg>
      ) : null}
    </View>
  );
}

/** The indigo hero band at the top of sign-in, Home and the Job Board: a gradient with soft light,
 * faint stars and the logo as a watermark. Includes the safe-area top inset. */
export function GradientHero({ children, height }: GradientHeroProps) {
  const insets = useSafeAreaInsets();
  const sized = height != null;
  const g = brandGradients.hero;

  return (
    <LinearGradient
      colors={g.colors as unknown as string[]}
      locations={g.locations as unknown as number[]}
      start={g.start}
      end={g.end}
      style={[styles.hero, sized ? { minHeight: height + insets.top } : null, { paddingTop: insets.top }]}
    >
      <HeroDecor />
      <View style={[styles.content, sized && styles.contentFill]}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    overflow: 'hidden',
    position: 'relative',
  },
  content: {
    zIndex: 1,
  },
  contentFill: {
    flex: 1,
  },
});
