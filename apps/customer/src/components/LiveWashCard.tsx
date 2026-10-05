import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { liveStatusText, type LiveStatus } from '@mana/domain';
import {
  Gradient,
  IconCheck,
  IconMapPin,
  IconPhone,
  colors,
  formatRupees,
  radius,
  shadow,
} from '@mana/ui';
import type { Branch, LiveWash } from '../api/types';
import { callNumber, openDirections } from '../utils/contact';

const STEPS: { status: LiveStatus; label: string }[] = [
  { status: 'waiting', label: 'In queue' },
  { status: 'washing', label: 'Washing' },
  { status: 'ready', label: 'Ready' },
];

/** Indigo while it is being washed; amber once it is ready. */
const accents = (ready: boolean) =>
  ready
    ? { main: colors.amber, ring: 'rgba(245,158,11,0.2)', label: colors.amberDeep, title: colors.amberDeep, grad: ['#FBBF24', colors.amber] }
    : { main: colors.indigoBright, ring: 'rgba(84,104,212,0.18)', label: colors.indigoMid, title: colors.indigoDeep, grad: [colors.indigoBright, colors.indigoMid] };

/** The current step's dot has a soft ring that breathes while the wash is in progress. */
function Ring({ color, still }: { color: string; still: boolean }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (still) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [still, scale]);
  return <Animated.View style={[styles.ring, { backgroundColor: color, transform: [{ scale }] }]} />;
}

/** In queue → Washing → Ready, the same three steps as the Wash Manager's job page. */
function Steps({ status, ready }: { status: LiveStatus; ready: boolean }) {
  const reached = STEPS.findIndex((s) => s.status === status);
  const a = accents(ready);
  return (
    <View style={styles.stepper}>
      {STEPS.map((s, i) => {
        const done = i < reached;
        const current = i === reached;
        const reachedOrCurrent = i <= reached;
        return (
          <React.Fragment key={s.status}>
            {i > 0 ? (
              i <= reached ? (
                <Gradient spec={{ colors: a.grad, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }} style={styles.bar} />
              ) : (
                <View style={[styles.bar, styles.barOff]} />
              )
            ) : null}
            <View style={styles.step}>
              <View style={styles.dotSlot}>
                {current ? <Ring color={a.ring} still={ready} /> : null}
                {done ? (
                  <Gradient spec={{ colors: a.grad, start: { x: 0.2, y: 0 }, end: { x: 0.8, y: 1 } }} style={styles.dot}>
                    <IconCheck size={11} color={colors.white} />
                  </Gradient>
                ) : (
                  <View style={[styles.dot, styles.dotOff, current && { borderColor: a.main }]}>
                    {current ? <View style={[styles.dotCore, { backgroundColor: a.main }]} /> : null}
                  </View>
                )}
              </View>
              <Text style={[styles.stepLabel, reachedOrCurrent && { color: a.label }]}>{s.label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function ActionChip({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

interface LiveWashCardProps {
  wash: LiveWash;
  branch?: Branch;
  onPress: () => void;
  /** The first card on Home overlaps the hero. */
  overlap?: boolean;
}

/** Today's wash, live: where it is in the queue, and the bill and directions once it's ready. */
export function LiveWashCard({ wash, branch, onPress, overlap }: LiveWashCardProps) {
  const text = liveStatusText(wash.status, wash.ahead);
  const ready = wash.status === 'ready';
  const a = accents(ready);
  const services = wash.services.map((s) => (s.quantity > 1 ? `${s.name} × ${s.quantity}` : s.name)).join(', ');
  return (
    <View style={[styles.shell, overlap && styles.overlap]}>
      <View style={styles.clip}>
        <Gradient spec={{ colors: a.grad, start: { x: 0, y: 0 }, end: { x: 0, y: 1 } }} style={styles.accent} />
        <Pressable
          onPress={onPress}
          android_ripple={{ color: colors.indigoPale }}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${wash.vehicle.registrationNumber}: ${text.title}. ${text.body}`}
        >
          <View style={styles.head}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: a.title }]}>{text.title}</Text>
              <Text style={styles.sub}>{text.body}</Text>
            </View>
            <View style={styles.plate}>
              <Text style={styles.plateText}>{wash.vehicle.registrationNumber}</Text>
            </View>
          </View>
          <Steps status={wash.status} ready={ready} />
          <View style={styles.billRow}>
            <Text style={styles.meta} numberOfLines={2}>
              {services}
            </Text>
            <View style={styles.amount}>
              <Text style={styles.total}>{formatRupees(wash.total)}</Text>
              {ready ? <Text style={styles.toPay}>to pay</Text> : null}
            </View>
          </View>
        </Pressable>
        {ready && branch && (branch.phone || branch.location || branch.address) ? (
          <View style={styles.actions}>
            {branch.phone ? (
              <ActionChip
                icon={<IconPhone size={17} color={colors.indigoMid} />}
                label="Call the branch"
                onPress={() => callNumber(branch.phone!)}
              />
            ) : null}
            {branch.location || branch.address ? (
              <ActionChip
                icon={<IconMapPin size={17} color={colors.indigoMid} />}
                label="Directions"
                onPress={() => openDirections(branch)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  overlap: { marginTop: -44 },
  // Clips the accent bar to the card's rounded corners (the shadow stays on the shell).
  clip: { overflow: 'hidden', borderRadius: radius.lg - 1, paddingBottom: 0 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  pressed: { backgroundColor: colors.surface },
  body: { paddingTop: 16, paddingBottom: 16, paddingRight: 16, paddingLeft: 20 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  sub: { fontSize: 13.5, lineHeight: 19, color: colors.slateDeep, marginTop: 1 },
  plate: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 18, marginBottom: 16, marginHorizontal: 4 },
  step: { width: 62, alignItems: 'center', gap: 7 },
  dotSlot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 32, height: 32, borderRadius: 16 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotOff: { borderWidth: 2, borderColor: '#CBD3F5', backgroundColor: colors.white },
  dotCore: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: 12, fontWeight: '700', color: colors.slate },
  bar: { flex: 1, height: 3, marginTop: 10, borderRadius: 2 },
  barOff: { backgroundColor: '#D8DEF7' },
  billRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  meta: { flex: 1, fontSize: 13.5, color: colors.slateDeep },
  amount: { alignItems: 'flex-end' },
  total: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  toPay: { fontSize: 12, fontWeight: '800', color: colors.amberDeep },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 0, paddingBottom: 16, paddingRight: 16, paddingLeft: 20 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.indigoPale,
    borderWidth: 1,
    borderColor: '#D3DAF8',
  },
  actionPressed: { backgroundColor: colors.indigoMist },
  actionText: { fontSize: 14, fontWeight: '700', color: colors.indigoMid },
});
