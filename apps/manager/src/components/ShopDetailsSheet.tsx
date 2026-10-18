import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  BRAND_MARK,
  brandGradients,
  colors,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  showToast,
  IconAlert,
  IconBuilding,
  IconCalendar,
  IconLock,
  IconMapPin,
  IconPerson,
  IconShield,
  IconStore,
  IconTag,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { BranchLocationCard } from './BranchLocationCard';
import { BranchTypesCard } from './BranchTypesCard';

interface BranchDetails {
  code: string;
  status: 'active' | 'paused';
  statusReason: string | null;
  business: string | null;
  openedAt: string;
  owners: string[];
  location: { latitude: number; longitude: number } | null;
  pincode: string | null;
}

const OPENED = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** [x, y, radius, opacity] in the hero's 340 × 150 box. */
const STARS = [
  [26, 24, 1.3, 0.55],
  [92, 14, 1, 0.45],
  [150, 40, 1.2, 0.35],
  [210, 18, 1.5, 0.6],
  [120, 128, 1, 0.3],
  [40, 112, 1.1, 0.35],
] as const;

/** The night-indigo branch strip at the top: the logo as a watermark, name, city, code and status in one row. */
function BranchHero({ name, city, code, status }: { name: string; city: string; code: string; status: 'active' | 'paused' | null }) {
  const g = brandGradients.hero;
  return (
    <LinearGradient
      colors={g.colors as unknown as string[]}
      locations={g.locations as unknown as number[]}
      start={g.start}
      end={g.end}
      style={styles.hero}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 80" preserveAspectRatio="xMidYMid slice">
        {STARS.map(([x, y, r, o]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y * 0.55} r={r} fill="#FFFFFF" fillOpacity={o} />
        ))}
      </Svg>
      <Svg style={styles.watermark} width={96} height={96} viewBox="0 0 256 256">
        <G>
          <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.08} />
          <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.12} />
          <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.18} />
        </G>
      </Svg>
      <View style={styles.heroIcon}>
        <IconStore size={20} color={colors.indigo} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.heroName} numberOfLines={1}>
          {name || 'Your branch'}
        </Text>
        <View style={styles.heroCityRow}>
          {status ? <View style={[styles.statusDot, status === 'paused' && styles.statusDotPaused]} /> : null}
          <Text style={styles.heroCity} numberOfLines={1}>
            {[city, status === 'paused' ? 'Paused' : status === 'active' ? 'Active' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <View style={styles.codeChip}>
        <Text style={styles.codeChipLabel}>BRANCH</Text>
        <Text style={styles.codeChipValue}>{code}</Text>
      </View>
    </LinearGradient>
  );
}

/** A labelled input with an icon, in the soft rounded style of the rest of the app. */
function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  maxLength,
  focused,
  onFocus,
  onBlur,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  maxLength: number;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocus]}>
        {icon}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.slate}
          maxLength={maxLength}
          autoCapitalize="words"
        />
      </View>
    </View>
  );
}

/** One read-only fact, on one line. */
function InfoRow({
  icon: Icon,
  label,
  value,
  color,
  last,
}: {
  icon: (p: { size?: number; color?: string }) => React.ReactElement;
  label: string;
  value: string;
  color: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoDivider]}>
      <View style={[styles.infoIcon, { backgroundColor: `${color}14` }]}>
        <Icon size={15} color={color} />
      </View>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

type Tab = 'name' | 'location' | 'types' | 'branch';
const TABS: { key: Tab; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'location', label: 'Location' },
  { key: 'types', label: 'Services' },
  { key: 'branch', label: 'Info' },
];

/**
 * Owner: the branch's name and city (what customers see on messages and PDFs), where it is on the
 * map (movable), and below them the branch details Mana Wash HQ set when opening it, which the
 * branch can't change.
 */
export function ShopDetailsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { info, refresh } = useShop();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState<'name' | 'city' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<BranchDetails | null>(null);
  const [tab, setTab] = useState<Tab>('name');

  useEffect(() => {
    if (!visible) return;
    setName(info?.name ?? '');
    setCity(info?.city ?? '');
    setError(null);
    setSaving(false);
  }, [visible, info?.name, info?.city]);

  useEffect(() => {
    if (visible) setTab('name');
  }, [visible]);

  // Read fresh each time it opens; offline, the cached branch code still shows.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    api.shop.details
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body && 'code' in body) setDetails(body);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visible]);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const changed = trimmed !== (info?.name ?? '') || city.trim() !== (info?.city ?? '');
  const canSave = trimmed.length >= 2 && changed && !saving;
  const code = details?.code ?? info?.code ?? '—';
  const status = details?.status ?? info?.status ?? null;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.shop.info.$put({ json: { name: trimmed, city: city.trim() || null } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the shop name.'));
      await refresh();
      showToast('Shop details saved');
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Changing the shop name needs a connection.' : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!saving}
      title="Shop details"
      footer={
        tab === 'name' ? (
          <Button
            label={trimmed.length < 2 ? 'Enter the shop name' : changed ? 'Save changes' : 'No changes yet'}
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
        ) : undefined
      }
    >
      <BranchHero name={trimmed} city={city.trim()} code={code} status={status} />

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'name' ? (
        <>
          <Field
            label="Shop name"
            icon={<IconStore size={17} color={focus === 'name' ? colors.indigo : colors.slate} />}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Kovur"
            maxLength={60}
            focused={focus === 'name'}
            onFocus={() => setFocus('name')}
            onBlur={() => setFocus(null)}
          />
          <Field
            label="City"
            icon={<IconMapPin size={17} color={focus === 'city' ? colors.indigo : colors.slate} />}
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Kovur"
            maxLength={40}
            focused={focus === 'city'}
            onFocus={() => setFocus('city')}
            onBlur={() => setFocus(null)}
          />
          <Text style={styles.hint}>Customers see this name on WhatsApp messages and reports.</Text>
          {error ? (
            <View style={styles.errorRow}>
              <IconAlert size={15} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </>
      ) : tab === 'types' ? (
        <BranchTypesCard />
      ) : tab === 'location' ? (
        <BranchLocationCard
          location={details?.location ?? null}
          pincode={details?.pincode ?? null}
          canEdit
          onSaved={(location) => setDetails((d) => (d ? { ...d, location } : d))}
        />
      ) : (
        <View style={styles.info}>
          <View style={styles.lockRow}>
            <IconLock size={12} color={colors.indigo} />
            <Text style={styles.lockText}>Set by Mana Wash HQ · can’t be changed here</Text>
          </View>
          <InfoRow icon={IconTag} color="#1B2878" label="Branch code" value={code} />
          <InfoRow icon={IconBuilding} color="#5B21B6" label="Business" value={details?.business ?? '—'} />
          <InfoRow icon={IconCalendar} color="#0369A1" label="Opened on" value={details ? OPENED.format(new Date(details.openedAt)) : '—'} />
          <InfoRow
            icon={IconShield}
            color={status === 'paused' ? '#9A5B00' : '#0B5F57'}
            label="Status"
            value={status === 'paused' ? `Paused${details?.statusReason ? `: ${details.statusReason}` : ''}` : status === 'active' ? 'Active' : '—'}
          />
          <InfoRow
            icon={IconPerson}
            color="#0B5F57"
            label={details && details.owners.length > 1 ? 'Owners' : 'Owner'}
            value={details?.owners.length ? details.owners.join(', ') : '—'}
            last
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    overflow: 'hidden',
  },
  watermark: { position: 'absolute', right: -14, top: -18 },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: { ...typography.heading, fontSize: 19, color: colors.white, letterSpacing: -0.2 },
  heroCityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  heroCity: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.8)', flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.tealLight },
  statusDotPaused: { backgroundColor: colors.amberLight },
  codeChip: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  codeChipLabel: { ...typography.caption, fontSize: 9.5, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.2, fontWeight: '700' },
  codeChipValue: { ...typography.bodyStrong, fontSize: 14, color: colors.white, letterSpacing: 1.2, fontWeight: '800' },

  tabs: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { fontSize: 13, fontWeight: '800', color: colors.slateDeep },
  tabTextOn: { color: colors.white },

  field: { gap: 6 },
  label: { ...typography.caption, color: colors.slateDeep },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputWrapFocus: { borderColor: colors.indigo, backgroundColor: colors.white },
  input: { ...typography.body, flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  hint: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },

  info: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  lockText: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 2 },
  infoDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  infoIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { ...typography.label, fontSize: 13.5, color: colors.slateDeep, width: 96 },
  infoValue: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700', flex: 1, textAlign: 'right' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0, flex: 1 },
});
