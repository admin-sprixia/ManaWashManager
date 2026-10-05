import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { stampsToGo } from '@mana/domain';
import { Gradient, IconAlert, IconCheck, IconGift, IconStar, brandGradients, colors, radius, shadow } from '@mana/ui';
import { warning, type Card } from './StampCard';

/** Cards up to this size draw one drop per stamp; bigger ones draw only the meter. */
const MAX_DROPS = 12;
const REWARD = 46;
const LINE_MIN = 18;
const DROP_PATH = 'M18 2 C18 2 4 17 4 27 A14 14 0 0 0 32 27 C32 17 18 2 18 2 Z';

interface FreeWashCardProps {
  card: Card;
  now?: Date;
  /** The plate, when the customer has more than one vehicle. */
  vehicle?: string;
}

/** One stamp, as a water drop: filled and checked when collected, a dashed outline when not. */
function Stamp({ on, width, id }: { on: boolean; width: number; id: string }) {
  const height = (width * 42) / 36;
  return (
    <View style={{ width, height }} accessible={false}>
      <Svg width={width} height={height} viewBox="0 0 36 42">
        {on ? (
          <>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#7F93E6" />
                <Stop offset="0.5" stopColor="#4458CC" />
                <Stop offset="1" stopColor={colors.indigoDeep} />
              </LinearGradient>
            </Defs>
            <Path d={DROP_PATH} fill={`url(#${id})`} />
          </>
        ) : (
          <Path d={DROP_PATH} fill={colors.surface} stroke={colors.indigoMist} strokeWidth={2} strokeDasharray="3.5 3.5" />
        )}
      </Svg>
      {on ? (
        <View style={[styles.check, { top: (15 / 42) * height }]}>
          <IconCheck size={Math.round((15 / 36) * width)} color={colors.white} />
        </View>
      ) : null}
    </View>
  );
}

/** A free-wash card for Home: stamps as water drops leading to the gold reward, a meter and a line of progress. */
export function FreeWashCard({ card, now = new Date(), vehicle }: FreeWashCardProps) {
  const free = card.free > 0;
  const warn = warning(card, now);
  const left = stampsToGo(card.every, card);
  const gid = React.useId().replace(/[^a-zA-Z0-9]/g, '');

  const [trackWidth, setTrackWidth] = React.useState(0);
  const drops = card.every <= MAX_DROPS;
  const gap = card.every > 7 ? 5 : 9;
  const stampWidth = trackWidth
    ? Math.max(14, Math.min(36, Math.floor((trackWidth - REWARD - LINE_MIN - gap * (card.every + 1)) / card.every)))
    : 36;

  // The reward tile pulses while a free wash is waiting.
  const pulse = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!free) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [free, pulse]);

  const percent = free ? 100 : Math.min(100, (card.stamps / card.every) * 100);
  const summary = free
    ? card.free === 1
      ? 'A free wash is ready. Ask for it on your next visit.'
      : `${card.free} free washes are ready.`
    : `${left} more ${left === 1 ? 'wash' : 'washes'} and the next one is free.`;

  return (
    <View style={[styles.card, free && styles.cardFree]}>
      <Gradient
        spec={free ? brandGradients.rewardCard : brandGradients.cardLift}
        style={[StyleSheet.absoluteFill, styles.cardFill]}
      />
      <View style={styles.body} accessible accessibilityLabel={`${card.serviceName}: ${card.stamps} of ${card.every} stamps. ${summary}${warn ? ` ${warn}.` : ''}`}>
        <View style={styles.head}>
          {free ? (
            <Gradient spec={brandGradients.gold} style={[styles.tile, styles.tileFree]}>
              <IconStar size={19} color={colors.goldInk} filled />
            </Gradient>
          ) : (
            <Gradient spec={brandGradients.tile} style={styles.tile}>
              <IconStar size={19} color={colors.indigo} />
            </Gradient>
          )}
          <Text style={styles.title} numberOfLines={1}>
            {card.serviceName}
          </Text>
          {vehicle ? (
            <View style={styles.plate}>
              <Text style={styles.plateText}>{vehicle}</Text>
            </View>
          ) : null}
          <View style={[styles.count, free && styles.countFree]}>
            <Text style={[styles.countText, free && styles.countTextFree]}>
              {card.stamps}/{card.every}
            </Text>
          </View>
        </View>

        {drops ? (
          <View style={[styles.track, { gap }]} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
            {Array.from({ length: card.every }, (_, i) => (
              <Stamp key={i} on={i < card.stamps} width={stampWidth} id={`${gid}s${i}`} />
            ))}
            <View style={styles.linkLine}>
              <Svg width="100%" height={2}>
                <Line x1="0" y1="1" x2="100%" y2="1" stroke={colors.indigoMist} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
              </Svg>
            </View>
            <Animated.View style={[styles.rewardShell, { transform: [{ scale: pulse }] }]}>
              <Gradient spec={brandGradients.gold} style={styles.reward}>
                <IconGift size={24} color={colors.goldInk} />
              </Gradient>
            </Animated.View>
          </View>
        ) : (
          <View style={styles.trackSpacer} />
        )}

        <View style={[styles.meter, free && styles.meterFree]}>
          <Gradient
            spec={{ colors: free ? ['#FBBF24', colors.amber] : [colors.indigoBright, colors.indigo], start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }}
            style={[styles.fill, { width: `${percent}%` }]}
          />
        </View>

        <Text style={[styles.message, free && styles.messageFree]}>
          {free ? (
            summary
          ) : (
            <>
              <Text style={styles.messageStrong}>
                {left} more {left === 1 ? 'wash' : 'washes'}
              </Text>
              {' and the next one is free.'}
            </>
          )}
        </Text>

        {warn ? (
          <View style={styles.warn}>
            <IconAlert size={14} color={colors.amberDeep} />
            <Text style={styles.warnText}>{warn}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The shadow lives on this plain-coloured shell (Android draws no elevation shadow under a bare gradient).
  card: {
    marginHorizontal: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  cardFree: { backgroundColor: '#FFF6D9', borderColor: '#F6DC8B', shadowColor: colors.amber, shadowOpacity: 0.18 },
  cardFill: { borderRadius: radius.lg - 1 },
  body: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 15 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.14)',
  },
  tileFree: { borderColor: 'rgba(255,255,255,0.5)', shadowColor: colors.amber, shadowOpacity: 0.35, shadowRadius: 7, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  title: { flex: 1, fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  plate: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  plateText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  count: { paddingVertical: 3, paddingHorizontal: 11, borderRadius: radius.pill, backgroundColor: colors.indigoPale },
  countFree: { backgroundColor: colors.amber },
  countText: { fontSize: 13, fontWeight: '800', color: colors.indigoMid },
  countTextFree: { color: colors.white },
  track: { flexDirection: 'row', alignItems: 'center', marginTop: 15, marginBottom: 12 },
  trackSpacer: { height: 12 },
  check: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  linkLine: { flex: 1, minWidth: LINE_MIN, height: 2 },
  rewardShell: {
    width: REWARD,
    height: REWARD,
    borderRadius: 15,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.38,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  reward: {
    width: REWARD,
    height: REWARD,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.indigoPale, overflow: 'hidden', marginBottom: 11 },
  meterFree: { backgroundColor: '#FBE3A0' },
  fill: { height: 6, borderRadius: 3 },
  message: { fontSize: 14, fontWeight: '600', color: colors.slateDeep, lineHeight: 20 },
  messageStrong: { color: colors.indigo, fontWeight: '800' },
  messageFree: { color: colors.amberDeep, fontWeight: '800' },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 },
  warnText: { fontSize: 13, fontWeight: '700', color: colors.amberDeep, flexShrink: 1 },
});
