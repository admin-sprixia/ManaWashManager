import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { PlateBadge } from '../components/newWash/Highlight';
import { showToast } from '../components/Toast';
import {
  IconCheck,
  IconChevronDown,
  IconGift,
  IconSparkle,
  IconWhatsApp,
} from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { useAuth } from '../api/auth';
import { buildWhatsAppLink, formatRelativeDate } from '../utils/format';
import { buildComebackMessage, buildReminderMessage } from '../utils/messages';
import type { RootStackParamList } from '../navigation/RootNavigator';

type RemindersScreenProps = NativeStackScreenProps<RootStackParamList, 'Reminders'>;

interface CouponSummary {
  id: string;
  code: string;
  percent: number;
  expiresAt: string;
}

interface ReminderItem {
  vehicleId: string;
  registrationNumber: string;
  vehicleType: string;
  customer: { id: string; name: string | null; phone: string };
  lastVisitAt: string;
  lastServices: string[];
  daysSince: number;
  bucket: 'due' | 'comeback';
  remindedAt: string | null;
  coupon: CouponSummary | null;
}

interface CouponRow extends CouponSummary {
  createdAt: string;
  redeemedAt: string | null;
  registrationNumber: string;
  customer: { id: string; name: string | null; phone: string };
  issuedBy: string;
  redeemedBy: string | null;
}

interface RemindersData {
  due: ReminderItem[];
  comeback: ReminderItem[];
  coupons: { active: CouponRow[]; redeemed: CouponRow[] };
  actionable: number;
  rules: { dueDays: number; comebackDays: number; validDays: number };
}

const REDEEMED_PREVIEW = 3;

function animate() {
  LayoutAnimation.configureNext({
    duration: 220,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
  });
}

function shortDate(input: string): string {
  return new Date(input).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

function openWhatsApp(phone: string, message: string): Promise<boolean> {
  return Linking.openURL(buildWhatsAppLink(phone, message))
    .then(() => true)
    .catch(() => {
      showToast('Couldn’t open WhatsApp — is it installed?', 'error');
      return false;
    });
}

export function RemindersScreen({ navigation }: RemindersScreenProps) {
  const { isOwner } = useAuth();
  const [data, setData] = useState<RemindersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAllRedeemed, setShowAllRedeemed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.reminders.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      setData((await res.json()) as RemindersData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load reminders.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const patchItem = (vehicleId: string, patch: Partial<ReminderItem> | null) => {
    setData((d) => {
      if (!d) return d;
      const apply = (list: ReminderItem[]) =>
        patch === null
          ? list.filter((i) => i.vehicleId !== vehicleId)
          : list.map((i) => (i.vehicleId === vehicleId ? { ...i, ...patch } : i));
      const due = apply(d.due);
      const comeback = apply(d.comeback);
      const actionable = [...due, ...comeback].filter((i) => !i.remindedAt && !i.coupon).length;
      return { ...d, due, comeback, actionable };
    });
  };

  const record = async (item: ReminderItem, action: 'reminded' | 'snooze' | 'dismiss') => {
    const res = await api.reminders[':vehicleId'].$post({
      param: { vehicleId: item.vehicleId },
      json: { action },
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res));
  };

  const remind = async (item: ReminderItem) => {
    const message = item.coupon
      ? buildComebackMessage({
          customerName: item.customer.name,
          registrationNumber: item.registrationNumber,
          vehicleType: item.vehicleType,
          code: item.coupon.code,
          percent: item.coupon.percent,
          expiresAt: item.coupon.expiresAt,
        })
      : buildReminderMessage({
          customerName: item.customer.name,
          registrationNumber: item.registrationNumber,
          vehicleType: item.vehicleType,
          daysSince: item.daysSince,
          lastServices: item.lastServices,
        });
    if (!(await openWhatsApp(item.customer.phone, message))) return;
    animate();
    patchItem(item.vehicleId, { remindedAt: new Date().toISOString() });
    record(item, 'reminded').catch(() =>
      showToast(
        'Message sent, but the reminder couldn’t be saved. Check your connection.',
        'error',
      ),
    );
  };

  const hide = async (item: ReminderItem, action: 'snooze' | 'dismiss') => {
    setBusy(item.vehicleId);
    try {
      await record(item, action);
      animate();
      patchItem(item.vehicleId, null);
      showToast(
        action === 'snooze'
          ? `${item.registrationNumber} snoozed for 3 days`
          : `${item.registrationNumber} hidden until its next visit`,
        'success',
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Couldn’t update. Check your connection.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  const sendOffer = async (item: ReminderItem) => {
    setBusy(item.vehicleId);
    try {
      const res = await api.reminders[':vehicleId'].coupon.$post({
        param: { vehicleId: item.vehicleId },
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const coupon = (await res.json()) as CouponSummary;
      animate();
      patchItem(item.vehicleId, { coupon, remindedAt: new Date().toISOString() });
      await openWhatsApp(
        item.customer.phone,
        buildComebackMessage({
          customerName: item.customer.name,
          registrationNumber: item.registrationNumber,
          vehicleType: item.vehicleType,
          code: coupon.code,
          percent: coupon.percent,
          expiresAt: coupon.expiresAt,
        }),
      );
      void load();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Couldn’t create the offer. Check your connection.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const redeemed = data?.coupons.redeemed ?? [];
  const visibleRedeemed = showAllRedeemed ? redeemed : redeemed.slice(0, REDEEMED_PREVIEW);
  const nothing =
    data && data.due.length === 0 && data.comeback.length === 0 && data.coupons.active.length === 0;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Reminders" onBack={() => navigation.goBack()} />
      </View>

      {!data ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={styles.emptyTitle}>Couldn’t load reminders</Text>
              <Text style={styles.emptyBody}>{error}</Text>
              <Pressable onPress={() => void load()} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.water} size="large" />
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.water}
              colors={[colors.water]}
            />
          }
        >
          <View style={styles.summary}>
            <SummaryFigure value={data.due.length} label="Due for a wash" />
            <View style={styles.summaryDivider} />
            <SummaryFigure value={data.comeback.length} label="Win back" tone="amber" />
            <View style={styles.summaryDivider} />
            <SummaryFigure value={data.coupons.active.length} label="Offers live" tone="teal" />
          </View>

          {nothing ? (
            <View style={styles.allClear}>
              <View style={styles.allClearIcon}>
                <IconSparkle size={30} color={colors.water} />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptyBody}>
                Vehicles show up here {data.rules.dueDays} days after their last wash.
              </Text>
            </View>
          ) : null}

          {data.due.length > 0 ? (
            <>
              <SectionHeader
                title="Due for a wash"
                caption={`Last wash ${data.rules.dueDays}+ days ago`}
                count={data.due.length}
              />
              <View style={styles.edgeList}>
                {data.due.map((item, i) => (
                  <ReminderRow
                    key={item.vehicleId}
                    item={item}
                    last={i === data.due.length - 1}
                    busy={busy === item.vehicleId}
                    onOpen={() =>
                      navigation.navigate('CustomerProfile', { customerId: item.customer.id })
                    }
                    onRemind={() => void remind(item)}
                    onSnooze={() => void hide(item, 'snooze')}
                    onDismiss={() => void hide(item, 'dismiss')}
                  />
                ))}
              </View>
            </>
          ) : null}

          {data.comeback.length > 0 ? (
            <>
              <SectionHeader
                title="Win them back"
                caption={`No visit in ${data.rules.comebackDays}+ days${isOwner ? ' · send a one-time offer' : ''}`}
                count={data.comeback.length}
              />
              <View style={styles.edgeList}>
                {data.comeback.map((item, i) => (
                  <ReminderRow
                    key={item.vehicleId}
                    item={item}
                    last={i === data.comeback.length - 1}
                    busy={busy === item.vehicleId}
                    canOffer={isOwner}
                    validDays={data.rules.validDays}
                    onOpen={() =>
                      navigation.navigate('CustomerProfile', { customerId: item.customer.id })
                    }
                    onRemind={() => void remind(item)}
                    onOffer={() => void sendOffer(item)}
                    onSnooze={() => void hide(item, 'snooze')}
                    onDismiss={() => void hide(item, 'dismiss')}
                  />
                ))}
              </View>
            </>
          ) : null}

          {data.coupons.active.length > 0 ? (
            <>
              <SectionHeader
                title="Live offers"
                caption="Valid once · this vehicle or the owner’s others"
                count={data.coupons.active.length}
              />
              <View style={styles.edgeList}>
                {data.coupons.active.map((c, i) => (
                  <CouponLine key={c.id} coupon={c} last={i === data.coupons.active.length - 1} />
                ))}
              </View>
            </>
          ) : null}

          {redeemed.length > 0 ? (
            <>
              <SectionHeader title="Used recently" caption="Last 30 days" count={redeemed.length} />
              <View style={styles.edgeList}>
                {visibleRedeemed.map((c, i) => (
                  <CouponLine key={c.id} coupon={c} last={i === visibleRedeemed.length - 1} used />
                ))}
                {redeemed.length > REDEEMED_PREVIEW ? (
                  <Pressable
                    onPress={() => {
                      animate();
                      setShowAllRedeemed((v) => !v);
                    }}
                    style={({ pressed }) => [styles.showAll, pressed && styles.pressed]}
                  >
                    <Text style={styles.showAllText}>
                      {showAllRedeemed ? 'Show less' : `Show all ${redeemed.length}`}
                    </Text>
                    <View style={showAllRedeemed ? styles.flip : undefined}>
                      <IconChevronDown size={16} color={colors.water} />
                    </View>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function SummaryFigure({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'amber' | 'teal';
}) {
  return (
    <View style={styles.summaryFigure}>
      <Text
        style={[
          styles.summaryValue,
          tone === 'amber' && { color: colors.amberDeep },
          tone === 'teal' && { color: colors.teal },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  caption,
  count,
}: {
  title: string;
  caption: string;
  count: number;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionCount}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      </View>
      <Text style={styles.sectionCaption}>{caption}</Text>
    </View>
  );
}

interface ReminderRowProps {
  item: ReminderItem;
  last: boolean;
  busy: boolean;
  canOffer?: boolean;
  validDays?: number;
  onOpen: () => void;
  onRemind: () => void;
  onOffer?: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
}

function ReminderRow({
  item,
  last,
  busy,
  canOffer,
  validDays,
  onOpen,
  onRemind,
  onOffer,
  onSnooze,
  onDismiss,
}: ReminderRowProps) {
  const name = item.customer.name?.trim() || item.customer.phone;
  const comeback = item.bucket === 'comeback';
  const offerFirst = comeback && canOffer && !item.coupon;

  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.rowTop, pressed && styles.pressed]}
      >
        <Avatar name={name} id={item.customer.id} size={42} />
        <View style={styles.rowCopy}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.rowMeta}>
            <PlateBadge plate={item.registrationNumber} size="sm" />
            <Text style={styles.rowMetaText} numberOfLines={1}>
              {item.vehicleType}
            </Text>
          </View>
          <Text style={styles.rowLast} numberOfLines={1}>
            {item.lastServices.length > 0 ? `${item.lastServices.join(' + ')} · ` : ''}
            {shortDate(item.lastVisitAt)}
          </Text>
        </View>
        <View style={[styles.daysPill, comeback && styles.daysPillAmber]}>
          <Text style={[styles.daysValue, comeback && styles.daysValueAmber]}>
            {item.daysSince}
          </Text>
          <Text style={[styles.daysLabel, comeback && styles.daysValueAmber]}>days</Text>
        </View>
      </Pressable>

      {item.coupon ? (
        <View style={styles.couponChip}>
          <IconGift size={15} color={colors.tealDeep} />
          <Text style={styles.couponChipText} numberOfLines={1}>
            <Text style={styles.couponCode}>{item.coupon.code}</Text> · {item.coupon.percent}% off ·
            till {shortDate(item.coupon.expiresAt)}
          </Text>
        </View>
      ) : null}

      {item.remindedAt ? (
        <View style={styles.remindedLine}>
          <IconCheck size={13} color={colors.teal} />
          <Text style={styles.remindedText}>
            {item.coupon ? 'Offer sent' : 'Reminded'}{' '}
            {formatRelativeDate(item.remindedAt).toLowerCase()}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator color={colors.water} style={styles.busy} />
        ) : offerFirst ? (
          <Pressable
            onPress={onOffer}
            style={({ pressed }) => [styles.primaryShell, pressed && styles.pressed]}
          >
            <LinearGradient
              colors={gradients.primaryButton as unknown as string[]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primary}
            >
              <IconGift size={15} color={colors.white} />
              <Text style={styles.primaryText}>Send offer</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            onPress={onRemind}
            style={({ pressed }) => [styles.whatsBtn, pressed && styles.pressed]}
          >
            <IconWhatsApp size={15} variant="mono" color={colors.white} />
            <Text style={styles.whatsText}>
              {item.coupon ? 'Resend offer' : item.remindedAt ? 'Remind again' : 'Remind'}
            </Text>
          </Pressable>
        )}
        {!busy && offerFirst ? (
          <Pressable
            onPress={onRemind}
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            hitSlop={4}
          >
            <IconWhatsApp size={14} variant="mono" color={colors.teal} />
            <Text style={styles.ghostTextTeal}>Remind</Text>
          </Pressable>
        ) : null}
        <View style={styles.flex} />
        {!busy ? (
          <>
            <Pressable
              onPress={onSnooze}
              style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
              hitSlop={4}
            >
              <Text style={styles.ghostText}>Snooze</Text>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
              hitSlop={4}
            >
              <Text style={styles.ghostText}>Dismiss</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {offerFirst && validDays ? (
        <Text style={styles.offerHint}>A random 5–10% off, valid {validDays} days, once.</Text>
      ) : null}
    </View>
  );
}

function CouponLine({ coupon, last, used }: { coupon: CouponRow; last: boolean; used?: boolean }) {
  const name = coupon.customer.name?.trim() || coupon.customer.phone;
  const left = daysLeft(coupon.expiresAt);
  return (
    <View style={[styles.couponRow, !last && styles.rowBorder]}>
      <View style={[styles.couponIcon, used && styles.couponIconUsed]}>
        {used ? (
          <IconCheck size={16} color={colors.teal} />
        ) : (
          <IconGift size={17} color={colors.waterDeep} />
        )}
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.couponRowCode}>{coupon.code}</Text>
        <Text style={styles.rowMetaText} numberOfLines={1}>
          {name} · {coupon.registrationNumber}
        </Text>
      </View>
      <View style={styles.couponRight}>
        <Text style={styles.couponPercent}>{coupon.percent}% off</Text>
        <Text style={[styles.couponWhen, !used && left <= 3 && styles.couponWhenSoon]}>
          {used
            ? `Used ${coupon.redeemedAt ? shortDate(coupon.redeemedAt) : ''}`
            : left <= 1
              ? 'Expires today'
              : `${left} days left`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  summary: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadow('sm'),
  },
  summaryFigure: { flex: 1, alignItems: 'center', gap: 2 },
  summaryValue: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 24,
    letterSpacing: -0.4,
  },
  summaryLabel: { ...typography.caption, color: colors.slateDeep, fontSize: 11 },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  allClear: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  allClearIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.heading, color: colors.waterInk },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center', fontSize: 14 },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: { ...typography.label, color: colors.white },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: 2,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { ...typography.heading, color: colors.waterInk, fontSize: 18 },
  sectionCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountText: { ...typography.caption, color: colors.waterDeep, fontWeight: '700' },
  sectionCaption: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: 14, gap: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowCopy: { flex: 1, gap: 4, alignItems: 'flex-start' },
  rowName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMetaText: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
  rowLast: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  daysPill: {
    minWidth: 52,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
  },
  daysPillAmber: { backgroundColor: '#FEF3C7' },
  daysValue: { ...typography.heading, color: colors.waterDeep, fontSize: 18, lineHeight: 22 },
  daysValueAmber: { color: colors.amberDeep },
  daysLabel: { ...typography.caption, color: colors.waterDeep, fontSize: 10 },
  couponChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginLeft: 54,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  couponChipText: { ...typography.caption, color: colors.tealDeep, letterSpacing: 0 },
  couponCode: { fontWeight: '800', letterSpacing: 0.6 },
  remindedLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 54 },
  remindedText: { ...typography.caption, color: colors.teal, letterSpacing: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 54 },
  busy: { paddingVertical: 8, paddingHorizontal: spacing.md },
  primaryShell: { borderRadius: radius.pill, overflow: 'hidden' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  primaryText: { ...typography.label, color: colors.white },
  whatsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#25D366',
  },
  whatsText: { ...typography.label, color: colors.white },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  ghostText: { ...typography.label, color: colors.slateDeep },
  ghostTextTeal: { ...typography.label, color: colors.teal },
  offerHint: {
    ...typography.caption,
    color: colors.slate,
    marginLeft: 54,
    marginTop: -4,
    letterSpacing: 0,
  },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  couponIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  couponIconUsed: { backgroundColor: '#ECFDF5' },
  couponRowCode: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 14,
    letterSpacing: 0.8,
  },
  couponRight: { alignItems: 'flex-end', gap: 2 },
  couponPercent: { ...typography.bodyStrong, color: colors.teal, fontSize: 15 },
  couponWhen: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  couponWhenSoon: { color: colors.amberDeep, fontWeight: '700' },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  showAllText: { ...typography.label, color: colors.water, fontSize: 14 },
  flip: { transform: [{ rotate: '180deg' }] },
});
