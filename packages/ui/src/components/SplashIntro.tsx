import React, { useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';
import { BRAND_MARK, BRAND_MARK_BOX } from './BrandMark';

/**
 * The opening animation of both apps, on the app icon's night-indigo tile:
 * - the glow comes up on the indigo background, and a few stars twinkle in;
 * - the drop's outline draws itself from the tip down both sides, the arms rise from the bottom,
 *   and the centre line draws down from its tip;
 * - the glass fills in, a light sweeps across it, and a glint lands on top;
 * - MANA writes itself letter by letter in the logo's line lettering, then the product line rises.
 * Then it fades away over the app. A tap skips ahead, and with "Remove animations" on it simply
 * shows the finished logo for a moment.
 *
 * Every shape comes from BRAND_MARK and the logo lettering (branding/build-logos.mjs), so it is the
 * same logo as the icon. The background gradient is the Android launch window's too
 * (drawable/splash_window.xml), so the app opens on it and the logo starts drawing straight away.
 */

export const SPLASH_BACKGROUND = colors.nightDeep;
/** The top of the background gradient, for the status bar above it. */
const SPLASH_TOP = colors.indigo;

/** Milliseconds from the start. Each step overlaps the next so the whole thing reads as one move. */
const T = {
  sheen: [0, 600],
  glow: [0, 1200],
  dropLine: [100, 1200],
  armsLine: [500, 1500],
  centreLine: [850, 1550],
  glass: [1200, 1800],
  edgeSettle: [1350, 1850],
  whites: [1400, 1900],
  gloss: [1550, 2100],
  sweep: [1800, 2500],
  glint: [2300, 2900],
  word: [1600, 120, 520], // start, stagger per letter, duration per letter
  product: [2300, 2800],
  // The app starts mounting underneath once the lines are drawn: line drawing runs on the JS
  // thread, and building the app's screens at the same time would make it skip frames.
  reveal: 2550,
  exitAt: 3150,
  exit: 450,
} as const;

// The drop, arms and centre split into mirrored halves, so each draws symmetrically.
const HALVES = {
  dropRight: 'M128 14C128 14 212 96 212 158A84 84 0 0 1 128 242',
  dropLeft: 'M128 14C128 14 44 96 44 158A84 84 0 0 0 128 242',
  armsLeft:
    'M128 237.08A78.96 78.96 0 0 1 49.04 158.12C49.04 133.01 63.69 104.42 80.37 80C87.04 101.53 66.68 132.46 66.68 158.54A61.32 61.32 0 0 0 128 219.86',
  armsRight:
    'M128 237.08A78.96 78.96 0 0 0 206.96 158.12C206.96 133.01 192.31 104.42 175.63 80C168.96 101.53 189.32 132.46 189.32 158.54A61.32 61.32 0 0 1 128 219.86',
  centreRight: 'M128 56C128 56 138 128 138 166A10 10 0 0 1 128 176',
  centreLeft: 'M128 56C128 56 118 128 118 166A10 10 0 0 0 128 176',
};
/** Path lengths in the 256 box (measured once), so each line draws at an even speed. */
const LEN = { drop: 302.1, arms: 386.3, centre: 126.2 };

/** The logo's line lettering, in a 100-unit cap (copied from branding/build-logos.mjs). */
/** `len` (path length) is only needed for letters that draw themselves: the ones in MANA. */
type Glyph = { w: number; strokes: { d: string; len?: number }[] };
const GLYPHS: Record<string, Glyph> = {
  M: { w: 122, strokes: [{ d: 'M0 100V0L61 68L122 0V100', len: 382.7 }] },
  A: {
    w: 104,
    strokes: [
      { d: 'M0 100L52 0L104 100', len: 225.4 },
      { d: 'M18 68H86', len: 68 },
    ],
  },
  N: { w: 90, strokes: [{ d: 'M0 100V0L90 100V0', len: 334.5 }] },
  H: { w: 86, strokes: [{ d: 'M0 0V100M86 0V100M0 50H86' }] },
  E: { w: 66, strokes: [{ d: 'M66 0H0V100H66M0 50H54' }] },
  R: { w: 84, strokes: [{ d: 'M0 100V0H46A27 27 0 0 1 46 54H0M42 54L84 100' }] },
  P: { w: 76, strokes: [{ d: 'M0 100V0H46A27 27 0 0 1 46 54H0' }] },
  T: { w: 84, strokes: [{ d: 'M0 0H84M42 0V100' }] },
  S: {
    w: 60,
    strokes: [
      {
        d: 'M54 17C48 5 38 0 30 0C13 0 5 11 5 24C5 38 16 44 30 50C44 56 55 62 55 76C55 89 46 100 30 100C17 100 8 93 4 81',
      },
    ],
  },
  W: { w: 148, strokes: [{ d: 'M0 0L37 100L74 0L111 100L148 0' }] },
  ' ': { w: 28, strokes: [] },
};

function layout(text: string, gap: number) {
  let x = 0;
  const chars = [...text];
  const placed = chars.map((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`SplashIntro: no glyph for "${ch}"`);
    const at = x;
    x += g.w + (i < chars.length - 1 ? gap : 0);
    return { ...g, x: at };
  });
  return { placed, width: x };
}

/** The gap that makes `text` as wide as `width` (glyph units), like the logo's product line. */
function gapToFit(text: string, width: number) {
  const chars = [...text];
  const sum = chars.reduce((s, ch) => s + (GLYPHS[ch]?.w ?? 0), 0);
  return (width - sum) / Math.max(1, chars.length - 1);
}

/** Stars on the tile: [x, y] as fractions of the screen, size in px, and when each twinkles in. */
const STARS: [number, number, number, number][] = [
  [0.14, 0.12, 2.2, 150],
  [0.26, 0.07, 1.5, 420],
  [0.8, 0.1, 2.4, 260],
  [0.9, 0.22, 1.6, 640],
  [0.08, 0.33, 1.4, 880],
  [0.18, 0.74, 1.9, 520],
  [0.86, 0.79, 2.1, 340],
  [0.93, 0.56, 1.5, 760],
  [0.62, 0.05, 1.3, 980],
  [0.36, 0.9, 1.6, 700],
  [0.7, 0.93, 1.3, 1100],
  [0.05, 0.58, 1.2, 1240],
];

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const smooth = Easing.bezier(0.65, 0, 0.35, 1);
const settle = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * `from` → `to` across [a, b] of a clock, eased. The native driver can't take an easing function,
 * so the curve is baked into 16 straight steps, which works on either driver.
 */
function seg(
  v: Animated.Value,
  [a, b]: readonly [number, number],
  from: number,
  to: number,
  easing: (t: number) => number = smooth,
) {
  const n = 16;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= n; i++) {
    inputRange.push(a + ((b - a) * i) / n);
    outputRange.push(from + (to - from) * easing(i / n));
  }
  return v.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
}

/** A line that draws itself: its length, and when it draws. */
interface Stroke {
  len: number;
  span: readonly [number, number];
  value: Animated.Value;
}

interface SplashIntroProps {
  /** The line under MANA, in capitals from the logo lettering: "WASH PARTNER" or "WASH". */
  product: string;
  /** Called once the lines are drawn (or straight away when skipped): start rendering the app then. */
  onReveal: () => void;
  /** Called once the splash has faded out; unmount it then. */
  onDone: () => void;
}

export function SplashIntro({ product, onReveal, onDone }: SplashIntroProps) {
  const { width, height } = useWindowDimensions();

  // Fades, scales and movement run on the native driver from one clock. SVG line drawing can't, so
  // each line has its own value that only runs while that line draws — the phone redraws a line
  // only while it's moving, never the whole logo every frame.
  const clock = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);

  const word = useMemo(() => layout('MANA', 44), []);
  const strokes = useMemo(() => {
    const line = (len: number, span: readonly [number, number]): Stroke => ({ len, span, value: new Animated.Value(0) });
    const [start, stagger, dur] = T.word;
    return {
      drop: line(LEN.drop, T.dropLine),
      arms: line(LEN.arms, T.armsLine),
      centre: line(LEN.centre, T.centreLine),
      // MANA letter by letter; an A draws its legs, then its bar.
      letters: word.placed.flatMap((g, i) => {
        const at = start + i * stagger;
        return g.strokes.map((s, j) => ({
          key: `${i}-${j}`,
          x: g.x,
          d: s.d,
          ...line(
            s.len ?? 0,
            g.strokes.length === 1 ? [at, at + dur] : j === 0 ? [at, at + dur * 0.8] : [at + dur * 0.7, at + dur],
          ),
        }));
      }),
      sweep: line(1, T.sweep),
    };
  }, [word]);
  const lines: Stroke[] = useMemo(
    () => [strokes.drop, strokes.arms, strokes.centre, ...strokes.letters, strokes.sweep],
    [strokes],
  );

  const revealed = useRef(false);
  const reveal = useRef(() => {
    if (revealed.current) return;
    revealed.current = true;
    onReveal();
  }).current;

  const leave = useRef(() => {
    if (leaving.current) return;
    leaving.current = true;
    reveal();
    Animated.timing(exit, { toValue: 1, duration: T.exit, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
      () => onDone(),
    );
  }).current;

  useEffect(() => {
    let cancelled = false;
    let run: Animated.CompositeAnimation | null = null;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          clock.setValue(T.exitAt);
          lines.forEach((l) => l.value.setValue(1));
          reveal();
          hold = setTimeout(leave, 700);
          return;
        }
        run = Animated.parallel([
          Animated.timing(clock, { toValue: T.exitAt, duration: T.exitAt, easing: Easing.linear, useNativeDriver: true }),
          ...lines.map((l) =>
            Animated.timing(l.value, {
              toValue: 1,
              delay: l.span[0],
              duration: l.span[1] - l.span[0],
              easing: l === strokes.sweep ? Easing.inOut(Easing.quad) : smooth,
              useNativeDriver: false,
            }),
          ),
        ]);
        run.start(({ finished }) => {
          if (finished) leave();
        });
        revealTimer = setTimeout(reveal, T.reveal);
      });
    return () => {
      cancelled = true;
      run?.stop();
      if (hold) clearTimeout(hold);
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, [clock, lines, strokes, leave]);

  /** A tap jumps to the finished logo, then leaves. */
  const skip = () => {
    if (leaving.current) return;
    clock.stopAnimation();
    lines.forEach((l) => {
      l.value.stopAnimation();
      l.value.setValue(1);
    });
    Animated.timing(clock, { toValue: T.exitAt, duration: 220, useNativeDriver: true }).start(() => leave());
  };

  // ─── Sizes ──────────────────────────────────────────────────────────────
  const short = Math.min(width, height);
  const markSize = Math.min(short * 0.42, 200);
  const cap = markSize * 0.22; // MANA's cap height in px
  const k = cap / 100;
  const wordPx = word.width * k;
  const productCap = cap * 0.3;
  const pk = productCap / 100;
  const productLine = useMemo(() => layout(product, gapToFit(product, word.width * (k / pk))), [product, word.width, k, pk]);
  const wordStroke = 13; // glyph units — a touch finer than the printed logo, for the screen
  const productStroke = Math.max(1.4, productCap * 0.13) / pk;
  const groupWidth = Math.max(markSize, wordPx + wordStroke * k);
  const groupHeight = markSize + cap * 0.62 + cap + productCap * 1.9 + productCap;
  const glowSize = markSize * 3.1;

  // ─── Native-driven ──────────────────────────────────────────────────────
  const fade = (inputRange: number[], outputRange: number[]) =>
    clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  const sheenOpacity = seg(clock, T.sheen, 0, 1);
  const glowOpacity = seg(clock, T.glow, 0, 1);
  const glowScale = seg(clock, T.glow, 0.6, 1, settle);
  const markScale = seg(clock, [0, 2300], 0.9, 1, settle);
  const markLift = seg(clock, [0, 2300], 10, 0, settle);
  const glassOpacity = seg(clock, T.glass, 0, 1);
  const glossOpacity = seg(clock, T.gloss, 0, 1);
  const edgeOpacity = fade([T.dropLine[0], T.dropLine[0] + 60, T.edgeSettle[0], T.edgeSettle[1]], [0, 1, 1, 0.4]);
  const linesOpacity = fade([T.armsLine[0], T.armsLine[0] + 60, T.whites[0], T.whites[1]], [0, 1, 1, 0]);
  const whitesOpacity = seg(clock, T.whites, 0, 1);
  const sweepOpacity = fade([T.sweep[0], T.sweep[0] + 100, T.sweep[1] - 100, T.sweep[1]], [0, 1, 1, 0]);
  const glintOpacity = fade([T.glint[0], T.glint[0] + 180, T.glint[1]], [0, 1, 0]);
  const glintScale = fade([T.glint[0], T.glint[0] + 220, T.glint[1]], [0.2, 1, 0.4]);
  const glintSpin = seg(clock, T.glint, 0, 1, Easing.out(Easing.quad)).interpolate({
    inputRange: [0, 1],
    outputRange: ['-30deg', '60deg'],
  });
  const productOpacity = seg(clock, T.product, 0, 1);
  const productRise = seg(clock, T.product, 8, 0, settle);
  const starDrift = seg(clock, [0, T.exitAt], 0, -10, Easing.linear);
  const screenOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const groupScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  // ─── Line drawing (JS, one value per line) ──────────────────────────────
  // The dash starts a stroke-width before the line, so a round cap can't show as a dot before the
  // line begins to draw; the gap is long enough that the next dash never shows.
  const dash = (s: Stroke, strokeWidth: number) => ({
    strokeDasharray: [s.len, s.len + 2 * strokeWidth],
    strokeDashoffset: s.value.interpolate({ inputRange: [0, 1], outputRange: [s.len + strokeWidth, 0] }),
  });
  const sweepX = strokes.sweep.value.interpolate({ inputRange: [0, 1], outputRange: [-150, 330] });

  // Where the glint lands: the gloss highlight at the drop's upper left (in the 256 box).
  const box = markSize / BRAND_MARK_BOX;
  const glint = { x: 96 * box, y: 70 * box, size: markSize * 0.2 };
  const viewBox = `0 0 ${BRAND_MARK_BOX} ${BRAND_MARK_BOX}`;
  /** One layer of the mark: its own SVG, faded natively. */
  const layer = (opacity: Animated.AnimatedInterpolation<number>, children: React.ReactNode) => (
    <Animated.View style={[styles.fill, { opacity }]}>
      <Svg width={markSize} height={markSize} viewBox={viewBox}>
        {children}
      </Svg>
    </Animated.View>
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: screenOpacity }]}
      accessible
      accessibilityLabel={`MANA ${product.toLowerCase()}`}
    >
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_TOP} />
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessible={false}>
        {/* The icon's indigo gradient, the same as the launch window (drawable/splash_window.xml)... */}
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="splashBg" x1="0.5" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor={SPLASH_TOP} />
              <Stop offset="0.5" stopColor={colors.nightMid} />
              <Stop offset="1" stopColor={SPLASH_BACKGROUND} />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#splashBg)" />
        </Svg>
        {/* ...then a soft sheen from the top, and the stars. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: sheenOpacity }]}>
          <Svg width={width} height={height}>
            <Defs>
              <RadialGradient id="splashSheen" cx="0.5" cy="0" r="0.8">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.12} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={width} height={height} fill="url(#splashSheen)" />
          </Svg>
        </Animated.View>

        {STARS.map(([fx, fy, size, at], i) => (
          <Animated.View
            key={i}
            style={[
              styles.star,
              {
                left: fx * width,
                top: fy * height,
                width: size,
                height: size,
                borderRadius: size / 2,
                opacity: fade([at, at + 300, at + 700, T.exitAt], [0, 0.9, 0.5, 0.6]),
                transform: [{ translateY: starDrift }],
              },
            ]}
          />
        ))}

        <View style={styles.centre} pointerEvents="none">
          <Animated.View style={{ alignItems: 'center', transform: [{ scale: groupScale }] }}>
            <View style={{ width: groupWidth, height: groupHeight, alignItems: 'center' }}>
              {/* The glow sits behind the drop, centred on its body. */}
              <Animated.View
                style={[
                  styles.layer,
                  {
                    width: glowSize,
                    height: glowSize,
                    left: (groupWidth - glowSize) / 2,
                    top: markSize * 0.58 - glowSize / 2,
                    opacity: glowOpacity,
                    transform: [{ scale: glowScale }],
                  },
                ]}
              >
                <Svg width={glowSize} height={glowSize}>
                  <Defs>
                    <RadialGradient id="splashGlow" cx="0.5" cy="0.5" r="0.5">
                      <Stop offset="0" stopColor="#5468D4" stopOpacity={0.55} />
                      <Stop offset="0.45" stopColor="#3445B0" stopOpacity={0.2} />
                      <Stop offset="1" stopColor="#3445B0" stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Rect width={glowSize} height={glowSize} fill="url(#splashGlow)" />
                </Svg>
              </Animated.View>

              <Animated.View
                style={{ width: markSize, height: markSize, transform: [{ translateY: markLift }, { scale: markScale }] }}
              >
                {/* The glass: depth below, then the face and its bounce light. */}
                {layer(
                  glassOpacity,
                  <>
                    <Defs>
                      <LinearGradient id="splashSide" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#2B3AA0" />
                        <Stop offset="1" stopColor="#0A1034" />
                      </LinearGradient>
                      <LinearGradient id="splashFace" x1="0.2" y1="0" x2="0.8" y2="1">
                        <Stop offset="0" stopColor="#9BAEF5" />
                        <Stop offset="0.45" stopColor="#4458CC" />
                        <Stop offset="1" stopColor="#1B2878" />
                      </LinearGradient>
                      <LinearGradient id="splashBounce" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0.5" stopColor="#A9B8FF" stopOpacity={0} />
                        <Stop offset="1" stopColor="#A9B8FF" stopOpacity={0.35} />
                      </LinearGradient>
                    </Defs>
                    <Path d={BRAND_MARK.drop} fill="url(#splashSide)" translateY={8} />
                    <Path d={BRAND_MARK.drop} fill="url(#splashFace)" />
                    <Path d={BRAND_MARK.drop} fill="url(#splashBounce)" />
                  </>,
                )}
                {layer(
                  glossOpacity,
                  <>
                    <Defs>
                      <RadialGradient id="splashGloss" cx="0.3" cy="0.22" r="0.5">
                        <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.8} />
                        <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                      </RadialGradient>
                    </Defs>
                    <Path d={BRAND_MARK.drop} fill="url(#splashGloss)" />
                  </>,
                )}
                {/* A band of light crossing the glass once it has filled. */}
                {layer(
                  sweepOpacity,
                  <>
                    <Defs>
                      <LinearGradient id="splashSweep" x1="0" y1="0" x2="1" y2="0">
                        <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                        <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.55} />
                        <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                      </LinearGradient>
                      <ClipPath id="splashDropClip">
                        <Path d={BRAND_MARK.drop} />
                      </ClipPath>
                    </Defs>
                    <G clipPath="url(#splashDropClip)">
                      <AnimatedRect
                        x={sweepX}
                        y={-60}
                        width={70}
                        height={380}
                        fill="url(#splashSweep)"
                        rotation={20}
                        originX={128}
                        originY={128}
                      />
                    </G>
                  </>,
                )}
                {/* The outline, drawn from the tip down both sides. */}
                {layer(
                  edgeOpacity,
                  <>
                    <Defs>
                      <LinearGradient id="splashEdge" x1="0.1" y1="0" x2="0.9" y2="1">
                        <Stop offset="0" stopColor="#FFFFFF" />
                        <Stop offset="1" stopColor="#9BAEF5" />
                      </LinearGradient>
                    </Defs>
                    {[HALVES.dropRight, HALVES.dropLeft].map((d) => (
                      <AnimatedPath
                        key={d}
                        d={d}
                        fill="none"
                        stroke="url(#splashEdge)"
                        strokeWidth={3.2}
                        strokeLinecap="round"
                        {...dash(strokes.drop, 3.2)}
                      />
                    ))}
                  </>,
                )}
                {/* Arms rising from the bottom, and the centre line drawing down from its tip. */}
                {layer(
                  linesOpacity,
                  <>
                    {[HALVES.armsLeft, HALVES.armsRight].map((d) => (
                      <AnimatedPath
                        key={d}
                        d={d}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        {...dash(strokes.arms, 2.6)}
                      />
                    ))}
                    {[HALVES.centreRight, HALVES.centreLeft].map((d) => (
                      <AnimatedPath
                        key={d}
                        d={d}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        {...dash(strokes.centre, 2.6)}
                      />
                    ))}
                  </>,
                )}
                {layer(
                  whitesOpacity,
                  <>
                    <Defs>
                      <LinearGradient id="splashRim" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#FFFFFF" />
                        <Stop offset="1" stopColor="#C4CCF0" />
                      </LinearGradient>
                    </Defs>
                    <Path d={BRAND_MARK.arms} fill="url(#splashRim)" />
                    <Path d={BRAND_MARK.centre} fill="#FFFFFF" />
                  </>,
                )}

                {/* The glint: a four-point star that flashes on the gloss. */}
                <Animated.View
                  style={[
                    styles.layer,
                    {
                      left: glint.x - glint.size / 2,
                      top: glint.y - glint.size / 2,
                      width: glint.size,
                      height: glint.size,
                      opacity: glintOpacity,
                      transform: [{ scale: glintScale }, { rotate: glintSpin }],
                    },
                  ]}
                >
                  <Svg width={glint.size} height={glint.size} viewBox="0 0 40 40">
                    <Path
                      d="M20 0C21.2 13 27 18.8 40 20C27 21.2 21.2 27 20 40C18.8 27 13 21.2 0 20C13 18.8 18.8 13 20 0Z"
                      fill="#FFFFFF"
                    />
                  </Svg>
                </Animated.View>
              </Animated.View>

              {/* MANA, written in the logo's line lettering. */}
              <View style={{ marginTop: cap * 0.62 }}>
                <Svg
                  width={wordPx + wordStroke * k}
                  height={cap + wordStroke * k}
                  viewBox={`${-wordStroke / 2} ${-wordStroke / 2} ${word.width + wordStroke} ${100 + wordStroke}`}
                >
                  {strokes.letters.map((s) => (
                    <G key={s.key} translateX={s.x}>
                      <AnimatedPath
                        d={s.d}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth={wordStroke}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        {...dash(s, wordStroke)}
                      />
                    </G>
                  ))}
                </Svg>
              </View>

              <Animated.View
                style={{ marginTop: productCap * 1.9, opacity: productOpacity, transform: [{ translateY: productRise }] }}
              >
                <Svg
                  width={productLine.width * pk + productStroke * pk}
                  height={productCap + productStroke * pk}
                  viewBox={`${-productStroke / 2} ${-productStroke / 2} ${productLine.width + productStroke} ${100 + productStroke}`}
                >
                  <G fill="none" stroke="#B9C6FF" strokeWidth={productStroke} strokeLinecap="round" strokeLinejoin="round">
                    {productLine.placed.flatMap((g, i) =>
                      g.strokes.map((s, j) => <Path key={`${i}-${j}`} d={s.d} translateX={g.x} />),
                    )}
                  </G>
                </Svg>
              </Animated.View>
            </View>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: SPLASH_BACKGROUND, zIndex: 1000, elevation: 1000 },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fill: { ...StyleSheet.absoluteFillObject },
  layer: { position: 'absolute' },
  star: { position: 'absolute', backgroundColor: '#FFFFFF' },
});
