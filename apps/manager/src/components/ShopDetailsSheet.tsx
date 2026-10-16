import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  BRAND_MARK,
  brandGradients,
  colors,
  radius,
  spacing,
  typography,
  Avatar,
  BottomSheet,
  Button,
  showToast,
  IconAlert,
  IconBuilding,
  IconCalendar,
  IconLock,
  IconMapPin,
  IconShield,
  IconStore,
  IconTag,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';

interface BranchDetails {
  code: string;
  status: 'active' | 'paused';
  statusReason: string | null;
  business: string | null;
  openedAt: string;
  owners: string[];
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

/** The night-indigo branch card at the top: stars, the logo as a watermark, name, code and status. */
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
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 150" preserveAspectRatio="xMidYMid slice">
        {STARS.map(([x, y, r, o]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
        ))}
      </Svg>
      {/* The logo watermark, pinned to the corner and running off the card's edge. */}
      <Svg style={styles.watermark} width={150} height={150} viewBox="0 0 256 256">
        <G>
          <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.08} />
          <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.12} />
          <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.18} />
        </G>
      </Svg>
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}>
          <IconStore size={22} color={colors.indigo} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroName} numberOfLines={1}>
            {name || 'Your branch'}
          </Text>
          {city ? (
            <View style={styles.heroCityRow}>
              <IconMapPin size={13} color="rgba(255,255,255,0.75)" />
              <Text style={styles.heroCity} numberOfLines={1}>
                {city}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.heroChips}>
        <View style={styles.codeChip}>
          <Text style={styles.codeChipLabel}>BRANCH</Text>
          <Text style={styles.codeChipValue}>{code}</Text>
        </View>
        {status ? (
          <View style={[styles.statusChip, status === 'paused' && styles.statusChipPaused]}>
            <View style={[styles.statusDot, status === 'paused' && styles.statusDotPaused]} />
            <Text style={styles.statusChipText}>{status === 'paused' ? 'Paused' : 'Active'}</Text>
          </View>
        ) : null}
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

/** Each detail tile has its own soft colour: the background, border, icon and label all match. */
const TILE_TONES = {
  indigo: { bg: '#EEF0FF', border: '#D9DEFB', fg: '#1B2878' },
  violet: { bg: '#F3EEFF', border: '#E2D6FD', fg: '#5B21B6' },
  sky: { bg: '#EAF6FD', border: '#CBE8FA', fg: '#0369A1' },
  teal: { bg: '#E7F8F3', border: '#C5EDE2', fg: '#0B5F57' },
  amber: { bg: '#FFF6DF', border: '#FBE3A6', fg: '#9A5B00' },
} as const;
type TileTone = keyof typeof TILE_TONES;

/** One read-only fact in the details grid. */
function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: (p: { size?: number; color?: string }) => React.ReactElement;
  label: string;
  value: string;
  tone: TileTone;
}) {
  const t = TILE_TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: t.bg, borderColor: t.border }]}>
      <View style={styles.tileIcon}>
        <Icon size={15} color={t.fg} />
      </View>
      <Text style={[styles.tileLabel, { color: t.fg }]}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Owner: the branch's name and city (what customers see on messages and PDFs), and below them the
 * branch details Mana Wash HQ set when opening it, which the branch can't change.
 */
export function ShopDetailsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { info, refresh } = useShop();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState<'name' | 'city' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<BranchDetails | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(info?.name ?? '');
    setCity(info?.city ?? '');
    setError(null);
    setSaving(false);
  }, [visible, info?.name, info?.city]);

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
      subtitle="Customers see this name on WhatsApp messages and reports."
      footer={
        <Button
          label={trimmed.length < 2 ? 'Enter the shop name' : changed ? 'Save changes' : 'No changes yet'}
          onPress={() => void save()}
          disabled={!canSave}
          loading={saving}
        />
      }
    >
      <BranchHero name={trimmed} city={city.trim()} code={code} status={status} />

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

      <View style={styles.details}>
        <View style={styles.detailsHead}>
          <View style={styles.lockBadge}>
            <IconLock size={12} color={colors.indigo} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.detailsTitle}>Branch details</Text>
            <Text style={styles.detailsSub}>Set by Mana Wash HQ · can’t be changed here</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <Tile icon={IconTag} tone="indigo" label="Branch code" value={code} />
          <Tile icon={IconBuilding} tone="violet" label="Business" value={details?.business ?? '—'} />
          <Tile
            icon={IconCalendar}
            tone="sky"
            label="Opened on"
            value={details ? OPENED.format(new Date(details.openedAt)) : '—'}
          />
          <Tile
            icon={IconShield}
            tone={status === 'paused' ? 'amber' : 'teal'}
            label="Status"
            value={
              status === 'paused'
                ? `Paused${details?.statusReason ? `: ${details.statusReason}` : ''}`
                : status === 'active'
                  ? 'Active'
                  : '—'
            }
          />
        </View>

        <View style={styles.owners}>
          <Text style={styles.tileLabel}>{details && details.owners.length > 1 ? 'Owners' : 'Owner'}</Text>
          {details?.owners.length ? (
            details.owners.map((owner) => (
              <View key={owner} style={styles.ownerRow}>
                <Avatar name={owner} size={34} />
                <Text style={styles.ownerName} numberOfLines={1}>
                  {owner}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.tileValue}>—</Text>
          )}
        </View>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    gap: spacing.md,
    overflow: 'hidden',
  },
  watermark: { position: 'absolute', right: -18, top: -12 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: { ...typography.heading, fontSize: 24, color: colors.white, letterSpacing: -0.3 },
  heroCityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  heroCity: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.8)' },
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  codeChipLabel: { ...typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.2, fontWeight: '700' },
  codeChipValue: { ...typography.bodyStrong, fontSize: 15, color: colors.white, letterSpacing: 1.5, fontWeight: '800' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(94,234,212,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(94,234,212,0.4)',
  },
  statusChipPaused: { backgroundColor: 'rgba(253,230,138,0.16)', borderColor: 'rgba(253,230,138,0.45)' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.tealLight },
  statusDotPaused: { backgroundColor: colors.amberLight },
  statusChipText: { ...typography.label, fontSize: 13, color: colors.white, fontWeight: '700' },
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
  details: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md,
  },
  detailsHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lockBadge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsTitle: { ...typography.bodyStrong, fontSize: 15.5, color: colors.ink, fontWeight: '700' },
  detailsSub: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm + 4,
    gap: 4,
  },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0.2, fontWeight: '600' },
  tileValue: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700' },
  owners: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm + 2,
    gap: spacing.sm,
  },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownerName: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700', flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0, flex: 1 },
});
