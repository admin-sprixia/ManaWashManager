import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconHome, IconMapPin, colors, radius, spacing, typography } from '@mana/ui';
import { type DoorstepVisitRules, type VisitCharge } from '@mana/domain';
import { currentLocation, LocationError, type Point } from '../../utils/location';

const kmText = (km: number) => `${Number.isInteger(km) ? km : km.toFixed(1)} km`;

/**
 * A home wash: the visit charge depends on how far the home is from the branch. Nobody types
 * it: the phone's location at the home is taken as soon as the doorstep menu opens, and the
 * server measures it again (or uses the customer's saved home) and charges once per visit.
 */
export function VisitCard({
  rules,
  point,
  charge,
  canUseSavedHome,
  onPoint,
  formatMoney,
}: {
  rules: DoorstepVisitRules;
  /** Where the phone was measured; null until it is. */
  point: Point | null;
  /** The charge from here, when the branch's pin is known; null otherwise. */
  charge: VisitCharge | null;
  /** A known customer: without a location, the server uses their saved home. */
  canUseSavedHome: boolean;
  onPoint: (point: Point | null) => void;
  formatMoney: (paise: number) => string;
}) {
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(false);

  const measure = useCallback(async () => {
    setLocating(true);
    setProblem(null);
    try {
      onPoint(await currentLocation('To measure how far this home is from the branch, for the visit charge.'));
    } catch (e) {
      onPoint(null);
      setProblem(e instanceof LocationError ? e.message : 'Couldn’t find your location. Turn on location (GPS) and try again.');
    } finally {
      setLocating(false);
    }
  }, [onPoint]);

  useEffect(() => {
    if (asked.current || point) return;
    asked.current = true;
    void measure();
  }, [measure, point]);

  const status = locating
    ? 'Measuring where you are…'
    : point && charge
      ? charge.tooFar
        ? `${kmText(charge.km)} from the branch: further than the team goes (${kmText(rules.maxKm)}).`
        : `${kmText(charge.km)} from the branch by road`
      : point
        ? 'Location found. The charge is worked out when the wash is saved.'
        : canUseSavedHome
          ? 'No location: their saved home will be used, if they have one.'
          : (problem ?? 'Turn on location to measure the visit.');

  return (
    <View style={[styles.card, charge?.tooFar && styles.cardBad]}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <IconHome size={18} color={colors.white} />
        </View>
        <View style={styles.headCopy}>
          <Text style={styles.title}>Visit charge</Text>
          <Text style={styles.sub}>
            {formatMoney(rules.visitFeePaise)} visit
            {rules.perKmPaise ? ` + ${formatMoney(rules.perKmPaise)}/km after ${kmText(rules.freeKm)}` : ''} · up to {kmText(rules.maxKm)}
          </Text>
        </View>
        {locating ? (
          <ActivityIndicator color={colors.tealDeep} />
        ) : (
          <Text style={[styles.amount, charge?.tooFar && styles.amountBad]}>
            {charge == null ? '—' : charge.tooFar ? 'Too far' : formatMoney(charge.total)}
          </Text>
        )}
      </View>

      <View style={styles.statusRow}>
        <IconMapPin size={16} color={point && !charge?.tooFar ? colors.tealDeep : colors.slateDeep} />
        <Text style={[styles.status, !point && !locating && !canUseSavedHome && styles.statusBad]}>{status}</Text>
      </View>

      {charge && !charge.tooFar && charge.steps.length > 1 ? (
        <View style={styles.steps}>
          {charge.steps.map((s) => (
            <View key={s.label} style={styles.step}>
              <Text style={styles.stepLabel}>{s.label}</Text>
              <Text style={styles.stepAmount}>{formatMoney(s.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!locating ? (
        <Pressable onPress={() => void measure()} style={({ pressed }) => [styles.again, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.againText}>{point ? 'Measure again' : 'Try again'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.foot}>Start the wash at the customer’s home. Once per visit: a second car here today pays no visit charge.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  cardBad: { backgroundColor: '#FFF7F7', borderColor: '#FECACA' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },
  sub: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  amount: { ...typography.heading, fontSize: 19, color: colors.tealDeep },
  amountBad: { color: colors.danger, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flex: 1, ...typography.label, fontSize: 13.5, color: colors.waterInk },
  statusBad: { color: colors.danger },
  steps: { gap: 3, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#99F6E4' },
  step: { flexDirection: 'row' },
  stepLabel: { flex: 1, ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  stepAmount: { ...typography.caption, fontSize: 12.5, color: colors.waterInk, fontWeight: '700', letterSpacing: 0 },
  again: { alignSelf: 'flex-start', paddingVertical: 2 },
  againText: { ...typography.label, fontSize: 13.5, color: colors.tealDeep, fontWeight: '800' },
  foot: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 16 },
});
