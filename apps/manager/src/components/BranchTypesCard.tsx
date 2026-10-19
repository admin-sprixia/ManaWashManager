import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { branchServicesProblem, type BranchServiceKey, type BranchServices } from '@mana/domain';
import { IconAlert, IconBuilding, IconHome, IconLock, IconStore, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { announceLanes } from './board/lanes';

type Services = { allowed: BranchServices; offered: BranchServices; live: BranchServices };

export const SERVICE_ROWS: { key: BranchServiceKey; title: string; text: string; color: string; bg: string; Icon: typeof IconStore }[] = [
  { key: 'hub', title: 'Hub', text: 'Customers bring the vehicle to the shop.', color: '#1B2878', bg: '#EEF0FF', Icon: IconStore },
  {
    key: 'community',
    title: 'Community',
    text: 'The team washes plan cars at apartments and colonies on fixed days.',
    color: '#0B5F57',
    bg: '#E7F8F3',
    Icon: IconBuilding,
  },
  { key: 'doorstep', title: 'Doorstep', text: 'The same team washes at a customer’s home when they ask.', color: '#9A5B00', bg: '#FFF6DF', Icon: IconHome },
];

/**
 * The owner's switches for what the branch offers — at the hub, at communities, at customers'
 * doors — within what head office's agreement allows. Switching one on makes its hub or team at
 * the branch's location; Doorstep needs the community team.
 */
export function BranchTypesCard({ onChanged }: { onChanged?: () => void } = {}) {
  const [services, setServices] = useState<Services | null>(null);
  const [busy, setBusy] = useState<BranchServiceKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.services.network
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body?.services) setServices(body.services);
      })
      .catch((e: unknown) => live && setError(e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t load what the branch offers.'));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (key: BranchServiceKey, on: boolean) => {
    if (!services) return;
    const next: BranchServices = { ...services.live, [key]: on };
    // Doorstep rides on the community team: on brings it along, off takes Doorstep with it.
    if (key === 'doorstep' && on) next.community = true;
    if (key === 'community' && !on) next.doorstep = false;
    const problem = branchServicesProblem(next);
    if (problem) return setError(problem);
    if (next.community && !services.allowed.community) return setError('Community isn’t in this branch’s agreement, and Doorstep needs it.');
    setBusy(key);
    setError(null);
    try {
      const res = await api.branch.types.$put({ json: next });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t change what the branch offers.'));
      const body = await res.json();
      setServices(body.services);
      announceLanes(body.lanes);
      onChanged?.();
      showToast(`${SERVICE_ROWS.find((t) => t.key === key)!.title} ${on ? 'switched on' : 'switched off'}`);
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection.' : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!services) {
    return error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={colors.indigo} style={styles.loading} />;
  }

  return (
    <View style={styles.card}>
      {SERVICE_ROWS.map((t, i) => {
        const allowed = services.allowed[t.key];
        const on = services.live[t.key];
        return (
          <View key={t.key} style={[styles.row, i < SERVICE_ROWS.length - 1 && styles.divider]}>
            <View style={[styles.icon, { backgroundColor: on ? t.bg : colors.surface }]}>
              <t.Icon size={18} color={on ? t.color : colors.slate} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, !on && styles.titleOff]}>{t.title}</Text>
              <Text style={styles.text}>{allowed ? t.text : 'Not in this branch’s agreement. Ask head office to add it.'}</Text>
            </View>
            {busy === t.key ? (
              <ActivityIndicator color={t.color} />
            ) : allowed ? (
              <Switch
                value={on}
                disabled={busy != null}
                onValueChange={(v) => void toggle(t.key, v)}
                trackColor={{ false: colors.border, true: colors.indigoMist }}
                thumbColor={on ? colors.indigo : colors.white}
                accessibilityLabel={`${t.title}: ${on ? 'on' : 'off'}`}
              />
            ) : (
              <View style={styles.lock} accessibilityLabel={`${t.title}: not in the agreement`}>
                <IconLock size={14} color={colors.slate} />
              </View>
            )}
          </View>
        );
      })}
      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: spacing.lg },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing.sm + 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  titleOff: { color: colors.slateDeep },
  text: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  lock: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: spacing.sm + 2 },
  errorText: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0, flex: 1 },
});
