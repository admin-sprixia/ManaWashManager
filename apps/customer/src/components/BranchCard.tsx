import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { hoursSummary, openState } from '@mana/domain';
import {
  IconClock,
  IconMapPin,
  IconPhone,
  IconStore,
  IconWhatsApp,
  colors,
  formatPhone,
  spacing,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill } from './CardList';
import type { Branch } from '../api/types';
import { callNumber, messageOnWhatsApp, openDirections } from '../utils/contact';

/** A round button on a row: the phone, or WhatsApp in its own soft green. */
function CircleButton({ children, label, onPress, tone }: { children: React.ReactNode; label: string; onPress: () => void; tone?: 'green' }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.circle, tone === 'green' && styles.circleGreen, pressed && styles.circlePressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

/** A branch as list rows: open now or not, address (tap for directions), hours, and the phone. */
export function BranchCard({ branch, now }: { branch: Branch; now: Date }) {
  const state = openState(branch.hours, now);
  const hours = hoursSummary(branch.hours);
  const canDirect = branch.location != null || branch.address != null;
  return (
    <EdgeGroup>
      <EdgeRow
        icon={<IconStore size={20} color={colors.indigo} />}
        title={branch.name}
        subtitle={state.kind === 'unknown' ? (branch.city ?? undefined) : state.label}
        right={
          state.kind === 'unknown' ? undefined : (
            <Pill label={state.kind === 'open' ? 'OPEN' : 'CLOSED'} tone={state.kind === 'open' ? 'teal' : 'amber'} />
          )
        }
      />
      {canDirect ? (
        <EdgeRow
          icon={<IconMapPin size={19} color={colors.tealDeep} />}
          iconBg={colors.tealPale}
          title={branch.address ?? branch.name}
          titleLines={3}
          subtitle="Tap for directions"
          onPress={() => openDirections(branch)}
        />
      ) : null}
      {hours ? (
        <EdgeRow
          icon={<IconClock size={19} color={colors.amberDeep} />}
          iconBg={colors.amberPale}
          title={hours}
          titleLines={2}
          subtitle="Opening hours"
        />
      ) : null}
      {branch.phone ? (
        <EdgeRow
          icon={<IconPhone size={18} color={colors.indigo} />}
          title={`+91 ${formatPhone(branch.phone)}`}
          subtitle="Call or WhatsApp us"
          right={
            <View style={styles.buttons}>
              <CircleButton label={`Call ${branch.name}`} onPress={() => callNumber(branch.phone!)}>
                <IconPhone size={17} color={colors.indigo} />
              </CircleButton>
              <CircleButton tone="green" label={`WhatsApp ${branch.name}`} onPress={() => messageOnWhatsApp(branch.phone!)}>
                <IconWhatsApp size={19} />
              </CircleButton>
            </View>
          }
        />
      ) : null}
    </EdgeGroup>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: spacing.sm },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  circleGreen: { backgroundColor: '#E8F8EE', borderColor: '#C5EBD3' },
  circlePressed: { opacity: 0.7 },
});
