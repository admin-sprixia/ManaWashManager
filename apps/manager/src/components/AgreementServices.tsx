import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { BranchServiceKey, BranchServices } from '@mana/domain';
import { colors, radius, spacing, typography } from '@mana/ui';
import { SERVICE_ROWS } from './BranchTypesCard';

/**
 * Head office's switches for what a branch's agreement allows: hub, communities, doorstep.
 * Doorstep needs Community (the same team), and a branch keeps the hub or Community.
 */
export function AgreementServices({
  value,
  onChange,
  disabled,
  live,
}: {
  value: BranchServices;
  onChange: (next: BranchServices) => void;
  disabled?: boolean;
  /** What runs at the branch now, to show "switched off by the owner". */
  live?: BranchServices;
}) {
  const set = (key: BranchServiceKey, on: boolean) => {
    const next = { ...value, [key]: on };
    if (key === 'doorstep' && on) next.community = true;
    if (key === 'community' && !on) next.doorstep = false;
    if (!next.hub && !next.community) return;
    onChange(next);
  };
  return (
    <View style={styles.card}>
      {SERVICE_ROWS.map((t, i) => {
        const on = value[t.key];
        const lastOne = on && (t.key === 'hub' ? !value.community : t.key === 'community' ? !value.hub : false);
        return (
          <View key={t.key} style={[styles.row, i < SERVICE_ROWS.length - 1 && styles.divider]}>
            <View style={[styles.icon, { backgroundColor: on ? t.bg : colors.surface }]}>
              <t.Icon size={18} color={on ? t.color : colors.slate} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, !on && styles.titleOff]}>{t.title}</Text>
              <Text style={styles.text}>
                {live && on ? (live[t.key] ? 'Running at the branch' : 'Allowed · switched off by the owner') : t.text}
              </Text>
            </View>
            <Switch
              value={on}
              disabled={disabled || lastOne}
              onValueChange={(v) => set(t.key, v)}
              trackColor={{ false: colors.border, true: colors.indigoMist }}
              thumbColor={on ? colors.indigo : colors.white}
              accessibilityLabel={`${t.title} in the agreement: ${on ? 'yes' : 'no'}`}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing.sm + 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  titleOff: { color: colors.slateDeep },
  text: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
});
