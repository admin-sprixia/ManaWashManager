import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { useAuth } from '../api/auth';
import { useShop, type RosterMember } from '../offline/ShopProvider';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { IconCheck } from './Icons';

export interface Person {
  id: string;
  name: string;
}

interface PeoplePickerSheetProps {
  visible: boolean;
  title: string;
  subtitle: string;
  confirmLabel: string;
  /** Most people that can be ticked. */
  max: number;
  /** Pre-selected people; defaults to whoever is signed in. */
  initial?: Person[];
  /** Shown once more than one person is ticked (e.g. how a commission is split). */
  sharedHint?: (count: number) => string;
  /** Adds a secondary action ("Skip" by default) — for optional records like who washed the car. */
  onSkip?: () => Promise<string | null>;
  skipLabel?: string;
  onClose: () => void;
  onConfirm: (people: Person[]) => Promise<string | null>;
}

/** Tick one or more team members — who washed a car, or who got a customer to take a service. */
export function PeoplePickerSheet({
  visible,
  title,
  subtitle,
  confirmLabel,
  max,
  initial,
  sharedHint,
  onSkip,
  skipLabel = 'Skip',
  onClose,
  onConfirm,
}: PeoplePickerSheetProps) {
  const { user } = useAuth();
  const { roster } = useShop();
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(initial && initial.length > 0 ? initial : user ? [{ id: user.id, name: user.name }] : []);
    setError(null);
    setBusy(false);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // People already on the job who've since left the team still show, so they can be removed.
  const people: RosterMember[] = [
    ...roster,
    ...picked.filter((p) => !roster.some((r) => r.id === p.id)).map((p) => ({ ...p, role: 'staff' })),
  ];
  if (user && !people.some((p) => p.id === user.id)) people.unshift({ id: user.id, name: user.name, role: user.role });

  const toggle = (m: RosterMember) => {
    setError(null);
    setPicked((prev) => {
      if (prev.some((p) => p.id === m.id)) return prev.filter((p) => p.id !== m.id);
      if (max === 1) return [{ id: m.id, name: m.name }];
      if (prev.length >= max) {
        setError(`At most ${max} people.`);
        return prev;
      }
      return [...prev, { id: m.id, name: m.name }];
    });
  };

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      subtitle={subtitle}
      footer={
        <View style={styles.footer}>
          {onSkip ? (
            <View style={styles.skip}>
              <Button label={skipLabel} variant="secondary" size="lg" disabled={busy} onPress={() => void run(onSkip)} />
            </View>
          ) : null}
          <View style={styles.confirm}>
            <Button
              label={picked.length > 1 ? `${confirmLabel} · ${picked.length} people` : confirmLabel}
              size="lg"
              loading={busy}
              disabled={picked.length === 0}
              onPress={() => void run(() => onConfirm(picked))}
            />
          </View>
        </View>
      }
    >
      <View style={styles.list}>
        {people.map((m, i) => {
          const on = picked.some((p) => p.id === m.id);
          return (
            <Pressable
              key={m.id}
              onPress={() => toggle(m)}
              android_ripple={{ color: colors.waterPale }}
              style={[styles.row, i > 0 && styles.rowDivider]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={m.name}
            >
              <Avatar name={m.name} id={m.id} size={36} />
              <Text style={styles.name} numberOfLines={1}>
                {m.name}
                {m.id === user?.id ? <Text style={styles.you}> (you)</Text> : null}
              </Text>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <IconCheck size={14} color={colors.white} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {picked.length > 1 && sharedHint ? <Text style={styles.hint}>{sharedHint(picked.length)}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: spacing.sm },
  skip: { flex: 1 },
  confirm: { flex: 2 },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.white,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  you: { ...typography.body, color: colors.slate },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.water, borderColor: colors.water },
  hint: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
