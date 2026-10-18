import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Avatar,
  BRAND_MARK,
  Button,
  IconEdit,
  IconPlus,
  IconSync,
  IconTrash,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  brandGradients,
  colors,
  shadow,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { NameSheet, plural, useCatalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'Business'>;

const formatPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

function NavRow({
  icon,
  iconBg,
  title,
  subtitle,
  right,
  last,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  last?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      android_ripple={onPress ? { color: colors.waterPale } : undefined}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowDivider,
        pressed && onPress && styles.pressedRow,
        disabled && styles.btnOff,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

/**
 * HQ settings: the business behind every branch, who may change its services and prices, and
 * tools to rebuild every branch's menu.
 */
export function BusinessScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { catalog, error, load, run } = useCatalog();
  const [renaming, setRenaming] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'import' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="HQ settings" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const updating = catalog.branches.filter((b) => !b.upToDate).length;
  const activeServices = catalog.services.filter((s) => s.active);
  const g = brandGradients.hero;
  const heroColors = (
    updating > 0 ? (['#F59E0B', '#D97706', '#92400E'] as const) : (g.colors as readonly string[])
  ) as unknown as string[];

  const addAdmin = async () => {
    const phone = normalizePhone(adminPhone);
    if (!isValidPhone(phone)) return setAdminError('Enter a valid 10-digit mobile number.');
    if (catalog.admins.includes(phone)) return setAdminError('Already an admin.');
    setAddingAdmin(true);
    const message = await run(() => api.business.admins.$post({ json: { phone } }), 'Admin added');
    setAddingAdmin(false);
    if (message) return setAdminError(message);
    setAdminPhone('');
    setAdminError(null);
  };

  const removeAdmin = (phone: string) => {
    const self = phone === user?.phone;
    showAlert(
      self ? 'Stop being an admin?' : `Remove +91 ${formatPhone(phone)}?`,
      self
        ? 'You won’t see Mana Wash HQ or change services and prices any more. Another admin can add you back.'
        : 'They keep running their branch, but can’t change services and prices for every branch any more.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const message = await run(
                () => api.business.admins[':phone'].$delete({ param: { phone } }),
                'Admin removed',
              );
              if (message) setActionError(message);
              else if (self) navigation.goBack();
            })();
          },
        },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );
  };

  const publish = async () => {
    setBusy('publish');
    setActionError(null);
    const message = await run(() => api.business.publish.$post(), 'Every branch’s menu is being updated');
    setBusy(null);
    if (message) setActionError(message);
  };


  const importMenu = () => {
    showAlert(
      'Copy this branch’s menu into the price list?',
      'Each service here that the price list doesn’t have yet is added, with this branch’s prices as base prices for sizes that have none. Every branch then gets them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: () => {
            void (async () => {
              setBusy('import');
              setActionError(null);
              const message = await run(
                () => api.business.import.$post({ json: {} }),
                'Menu copied into the price list',
              );
              setBusy(null);
              if (message) setActionError(message);
            })();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="HQ settings" onBack={() => navigation.goBack()} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        <View style={styles.stageWrap}>
          <LinearGradient
            colors={heroColors}
            locations={updating > 0 ? undefined : (g.locations as unknown as number[])}
            start={g.start}
            end={g.end}
            style={[styles.stage, shadow('md')]}
          >
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 390 240">
              <Defs>
                <RadialGradient id="glow" cx="78%" cy="18%" r="50%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.2" />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle cx="310" cy="40" r="120" fill="url(#glow)" />
              {[
                [30, 36, 1.3, 0.45],
                [88, 78, 1, 0.3],
                [160, 28, 1.2, 0.4],
                [340, 130, 1.1, 0.3],
              ].map(([x, y, r, o]) => (
                <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
              ))}
            </Svg>
            <Svg style={styles.heroMark} width={150} height={150} viewBox="0 0 256 256">
              <G>
                <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
                <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
                <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
              </G>
            </Svg>

            <View style={styles.stageTop}>
              <Text style={styles.stageEyebrow}>Mana Wash business</Text>
              <Pressable
                onPress={() => setRenaming(true)}
                style={({ pressed }) => [styles.renameChip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Rename business"
              >
                <IconEdit size={13} color={colors.white} />
                <Text style={styles.renameChipText}>Rename</Text>
              </Pressable>
            </View>

            <Text style={styles.stageName} numberOfLines={2} adjustsFontSizeToFit>
              {catalog.business.name}
            </Text>

            <View style={styles.syncRow}>
              <View style={[styles.syncDot, { backgroundColor: updating > 0 ? '#FDE68A' : '#5EEAD4' }]} />
              <Text style={styles.syncText}>
                {updating > 0
                  ? `Updating ${plural(updating, 'branch')}…`
                  : 'Every branch menu is up to date'}
              </Text>
            </View>

            <View style={styles.heroChips}>
              {[
                { label: 'Branches', value: catalog.branches.length },
                { label: 'Services', value: activeServices.length },
                { label: 'Books', value: catalog.priceBooks.length },
                { label: 'Admins', value: catalog.admins.length },
              ].map((c) => (
                <View key={c.label} style={styles.heroChip}>
                  <Text style={styles.heroChipLabel}>{c.label}</Text>
                  <Text style={styles.heroChipValue}>{c.value}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </View>

        <Text style={styles.sectionLabel}>Admins</Text>
        <Text style={styles.help}>
          Admins see Mana Wash HQ in More and change services, prices and rules for every branch.
        </Text>
        <View style={styles.band}>
          {catalog.admins.map((phone, i) => {
            const self = phone === user?.phone;
            const canRemove = catalog.admins.length > 1;
            return (
              <Pressable
                key={phone}
                onPress={canRemove ? () => removeAdmin(phone) : undefined}
                disabled={!canRemove}
                style={({ pressed }) => [
                  styles.adminRow,
                  i < catalog.admins.length - 1 && styles.rowDivider,
                  pressed && canRemove && styles.pressedRow,
                ]}
                accessibilityRole={canRemove ? 'button' : undefined}
                accessibilityLabel={canRemove ? `Remove admin +91 ${formatPhone(phone)}` : undefined}
              >
                <Avatar name={self ? 'You' : phone} id={phone} size={42} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>+91 {formatPhone(phone)}</Text>
                  <Text style={styles.rowMeta}>{self ? 'You' : 'Business admin'}</Text>
                </View>
                {canRemove ? <IconTrash size={16} color={colors.danger} /> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.addAdmin}>
          <PhoneField
            label="Add an admin"
            digits={adminPhone}
            onChangeDigits={(d) => {
              setAdminPhone(d);
              if (adminError) setAdminError(null);
            }}
            normalize={normalizePhone}
            error={adminError}
            onSubmit={() => void addAdmin()}
          />
          <Button
            label="Add admin"
            variant="secondary"
            icon={<IconPlus size={18} color={colors.indigo} />}
            loading={addingAdmin}
            onPress={() => void addAdmin()}
          />
        </View>

        <Text style={styles.sectionLabel}>Tools</Text>
        <View style={styles.band}>
          <NavRow
            icon={
              busy === 'publish' ? (
                <ActivityIndicator color={colors.indigo} />
              ) : (
                <IconSync size={18} color={colors.indigo} />
              )
            }
            iconBg={colors.indigoPale}
            title="Update every branch now"
            subtitle="Menus update by themselves — use this if one looks out of date"
            disabled={busy != null}
            onPress={() => void publish()}
          />
          <NavRow
            icon={
              busy === 'import' ? (
                <ActivityIndicator color={colors.indigo} />
              ) : (
                <IconPlus size={18} color={colors.indigo} />
              )
            }
            iconBg={colors.indigoPale}
            title="Copy this branch’s menu in"
            subtitle="Adds this branch’s own services to the price list"
            last
            disabled={busy != null}
            onPress={importMenu}
          />
        </View>

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      <NameSheet
        visible={renaming}
        title="Business name"
        label="Name"
        initial={catalog.business.name}
        maxLength={80}
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          const message = await run(() => api.business.$patch({ json: { name } }), 'Name saved');
          if (!message) setRenaming(false);
          return message;
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  loading: { marginTop: spacing.xl },
  pressed: { opacity: 0.78 },
  pressedRow: { backgroundColor: colors.surface },
  btnOff: { opacity: 0.45 },
  bottomPad: { height: spacing.lg },
  error: { ...typography.label, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.md },
  help: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: -spacing.sm,
    paddingHorizontal: spacing.md,
  },

  stageWrap: { marginTop: spacing.xs, marginHorizontal: spacing.md },
  stage: {
    borderRadius: 28,
    padding: spacing.md + 4,
    gap: 6,
    overflow: 'hidden',
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  stageTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stageEyebrow: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.75)' },
  renameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  renameChipText: { ...typography.label, color: colors.white, fontSize: 12.5, fontWeight: '700' },
  stageName: {
    ...typography.display,
    fontSize: 32,
    color: colors.white,
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  heroChips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    gap: 2,
  },
  heroChipLabel: { ...typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.2 },
  heroChipValue: { ...typography.bodyStrong, fontSize: 18, color: colors.white, fontWeight: '800' },

  sectionLabel: {
    ...typography.heading,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.2,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },

  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: {
    ...typography.bodyStrong,
    fontSize: 15.5,
    color: colors.waterInk,
    fontWeight: '800',
  },
  rowMeta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    lineHeight: 17,
  },


  togglePill: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    minWidth: 44,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: '#CCFBF1' },
  toggleOff: { backgroundColor: '#F1F5F9' },
  toggleText: { ...typography.label, fontSize: 12, fontWeight: '800' },
  toggleTextOn: { color: colors.tealDeep },
  toggleTextOff: { color: colors.slateDeep },

  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  addAdmin: { gap: spacing.sm, paddingHorizontal: spacing.md },
});
