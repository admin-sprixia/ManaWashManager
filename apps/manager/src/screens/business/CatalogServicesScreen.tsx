import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  IconPlus,
  IconSparkle,
  ScreenContainer,
  ScreenHeader,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { SERVICE_KIND_LABEL, formatDuration, servicePlacesLabel } from '@mana/domain';
import { Fab } from '../../components/Fab';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Band, BandRow, CatalogHero, SectionTitle, useCatalog, type CatalogService } from './shared';
import { groupServices } from './servicesShared';
import { WashPlansPane } from './WashPlansPane';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessServices'>;

/**
 * What head office sells: its services (grouped by vehicle, in the order New Wash and the app
 * list them) and, on the Plans tab, its wash plans.
 */
export function CatalogServicesScreen({ navigation, route }: Props) {
  const { catalog, error, load } = useCatalog();
  const [tab, setTab] = useState<'services' | 'plans'>(route.params?.tab ?? 'services');

  const active = useMemo(() => catalog?.services.filter((s) => s.active) ?? [], [catalog]);
  const groups = useMemo(() => (catalog ? groupServices(catalog, active) : []), [catalog, active]);
  const combos = active.filter((s) => s.includes.length > 0).length;

  const row = (s: CatalogService, last: boolean) => {
    if (!catalog) return null;
    const names = s.includes.map((id) => catalog.services.find((x) => x.id === id)?.name).filter(Boolean);
    const pill =
      s.includes.length > 0
        ? { label: 'Combo', bg: colors.indigoPale, fg: colors.indigo }
        : !(s.places.shop && s.places.community && s.places.doorstep)
          ? { label: servicePlacesLabel(s.places), bg: '#FEF3C7', fg: colors.amberDeep }
          : null;
    return (
      <BandRow
        key={s.id}
        icon={<IconSparkle size={18} color={colors.indigo} />}
        iconBg={colors.indigoPale}
        title={s.name}
        subtitle={[
          SERVICE_KIND_LABEL[s.kind],
          s.durationMin ? formatDuration(s.durationMin) : null,
          s.popular ? 'Most popular' : null,
          names.length ? names.join(' + ') : s.checklist.length ? `${s.checklist.length} things included` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        last={last}
        right={
          pill ? (
            <View style={[styles.pill, { backgroundColor: pill.bg }]}>
              <Text style={[styles.pillText, { color: pill.fg }]}>{pill.label}</Text>
            </View>
          ) : undefined
        }
        onPress={() => navigation.navigate('BusinessServiceEdit', { serviceId: s.id })}
      />
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Services and plans" onBack={() => navigation.goBack()} />
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(
          [
            ['services', 'Services'],
            ['plans', 'Plans'],
          ] as const
        ).map(([key, label]) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'plans' ? (
        <WashPlansPane />
      ) : !catalog ? (
        error ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <CatalogHero
            eyebrow="Mana Wash HQ"
            title="Services"
            meta="Create, edit and delete the services HQ offers."
            chips={[
              { label: 'Services', value: active.length },
              { label: 'Combos', value: combos },
            ]}
          />

          {active.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No services yet</Text>
              <Text style={styles.emptyBody}>Tap Add service to create your first one.</Text>
            </View>
          ) : (
            groups.map((g) => (
              <View key={g.key} style={styles.group}>
                <SectionTitle>{`${g.title} · ${g.items.length}`}</SectionTitle>
                <Band>{g.items.map((s, i) => row(s, i === g.items.length - 1))}</Band>
              </View>
            ))
          )}

          <View style={styles.bottomPad} />
        </ScrollView>
      )}
      {catalog && tab === 'services' ? (
        <Fab
          label="Add service"
          icon={<IconPlus size={22} color={colors.white} />}
          onPress={() => navigation.navigate('BusinessServiceEdit')}
          bottom={spacing.lg}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, fontSize: 14, color: colors.slateDeep, fontWeight: '800' },
  tabTextOn: { color: colors.white },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  footer: { gap: spacing.xs },
  error: { ...typography.label, color: colors.danger },
  pressed: { opacity: 0.7 },
  bottomPad: { height: 120 },
  empty: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  emptyTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '800' },
  emptyBody: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },
  pill: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
  },
  pillText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
  offToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  offLabel: { ...typography.heading, fontSize: 16, color: colors.ink, letterSpacing: -0.2 },
  offHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  pricesLink: {
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.indigoPale,
  },
  pricesLinkWarn: { backgroundColor: '#FEE2E2' },
  pricesLinkText: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '700' },
  pricesLinkTextWarn: { color: colors.danger },
  chevron: {},
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  moveLabel: { ...typography.label, color: colors.slateDeep, flex: 1 },
  moveBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveOff: { opacity: 0.35 },
  flip: { transform: [{ rotate: '180deg' }] },
});
