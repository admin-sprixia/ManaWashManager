import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconStore,
  colors,
  formatDateTime,
  formatRupees,
  radius,
  spacing,
  statusColors,
  typography,
  type PillTone,
} from '@mana/ui';
import { EdgeGroup, EdgePanel, EdgeRow, HAIRLINE, Pill, SectionLabel } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import type { PaymentMethod } from '@mana/domain';
import { api, send } from '../api/client';
import type { Wash } from '../api/types';
import { useBranches } from '../branches/BranchesProvider';
import { MessageCard } from '../components/MessageCard';
import { PhotoImage } from '../components/PhotoImage';
import { ProblemSummary } from '../components/ProblemSummary';
import { RateWashCard } from '../components/RateWashCard';
import { Shimmer, SkeletonList } from '../components/Skeleton';
import { WASH_STATUS_LABEL, washTitle } from '../components/WashRow';
import { useRemote } from '../hooks/useRemote';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'WashDetail'>;

const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', other: 'Other' };

const STATUS_PILL: Record<Wash['status'], PillTone> = {
  waiting: 'slate',
  washing: 'water',
  ready: 'amber',
  paid: 'teal',
};

/** One wash: what was done, the bill, its before/after photos, a rating and reports. */
export function WashDetailScreen({ navigation, route }: Props) {
  const { byId } = useBranches();
  const detail = useRemote(() => send(api.washes[':id'].$get({ param: { id: route.params.id } })));
  const wash = detail.data?.wash;

  const before = wash?.photos.filter((p) => p.kind === 'before') ?? [];
  const after = wash?.photos.filter((p) => p.kind === 'after') ?? [];
  const allIds = [...before, ...after].map((p) => p.id);
  const openPhoto = (id: string) => navigation.navigate('Photo', { photoIds: allIds, index: allIds.indexOf(id) });

  const photoGroup = (title: string, photos: typeof before) =>
    photos.length > 0 ? (
      <View style={styles.photoGroup}>
        <Text style={styles.photoTitle}>{title}</Text>
        <View style={styles.photoGrid}>
          {photos.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => openPhoto(p.id)}
              style={({ pressed }) => [styles.photoCell, pressed && styles.pressed]}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${title} photo`}
            >
              <PhotoImage photoId={p.id} style={styles.photo} />
            </Pressable>
          ))}
        </View>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader
        title={wash ? wash.vehicle.registrationNumber : 'Wash'}
        onBack={() => navigation.goBack()}
        right={
          wash ? <Pill label={WASH_STATUS_LABEL[wash.status].toUpperCase()} tone={STATUS_PILL[wash.status]} /> : undefined
        }
      />
      {!wash ? (
        detail.loading ? (
          <View>
            <View style={styles.summary}>
              <View style={styles.summaryBody}>
                <Shimmer style={{ height: 13, width: '60%' }} />
                <Shimmer style={{ height: 34, width: '40%', marginTop: 12 }} />
              </View>
            </View>
            <SkeletonList groups={[1, 2]} />
          </View>
        ) : (
          <MessageCard
            title="Couldn’t open this wash"
            body={detail.error ?? 'Check your connection and try again.'}
            action={{ label: 'Try again', onPress: () => void detail.reload() }}
          />
        )
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={() => void detail.reload()} />}
        >
          <View style={styles.summary}>
            <View style={styles.summaryClip}>
              <View style={[styles.summaryAccent, { backgroundColor: statusColors[wash.status].border }]} />
              <View style={styles.summaryBody}>
                <Text style={styles.summaryMeta}>
                  {washTitle(wash)} · {formatDateTime(wash.createdAt)}
                </Text>
                <Text style={styles.summaryTotal}>{formatRupees(wash.total)}</Text>
              </View>
            </View>
          </View>

          <SectionLabel>Branch</SectionLabel>
          <EdgeGroup>
            <EdgeRow
              icon={<IconStore size={19} color={colors.indigo} />}
              title={wash.branch.name}
              subtitle={wash.branch.city ?? undefined}
            />
          </EdgeGroup>

          <SectionLabel>Services</SectionLabel>
          <View style={styles.bill}>
            {wash.services.map((s, i) => (
              <View key={s.name} style={[styles.billRow, i > 0 && styles.billDivider]}>
                <Text style={styles.billName} numberOfLines={1}>
                  {s.name}
                  {s.quantity > 1 ? ` × ${s.quantity}` : ''}
                </Text>
              </View>
            ))}
            {wash.discount > 0 ? (
              <>
                <View style={[styles.billRow, styles.billDivider]}>
                  <Text style={styles.billMuted}>Subtotal</Text>
                  <Text style={styles.billMuted}>{formatRupees(wash.subtotal)}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billDiscount}>Discount</Text>
                  <Text style={styles.billDiscount}>− {formatRupees(wash.discount)}</Text>
                </View>
              </>
            ) : null}
            <View style={[styles.billRow, styles.billDivider]}>
              <Text style={styles.billTotalLabel}>Total</Text>
              <Text style={styles.billTotal}>{formatRupees(wash.total)}</Text>
            </View>
          </View>

          {wash.status === 'paid' && wash.paymentMethod ? (
            <>
              <SectionLabel>Payment</SectionLabel>
              <EdgeGroup>
                <EdgeRow
                  icon={<IconCheck size={18} color={colors.teal} />}
                  iconBg={colors.tealPale}
                  title={`${PAYMENT_LABEL[wash.paymentMethod as PaymentMethod] ?? wash.paymentMethod} · ${formatRupees(wash.total)}`}
                  subtitle="Paid, thank you"
                />
              </EdgeGroup>
            </>
          ) : null}

          <SectionLabel>Photos</SectionLabel>
          {wash.photos.length > 0 ? (
            <EdgePanel>
              {photoGroup('Before', before)}
              {photoGroup('After', after)}
            </EdgePanel>
          ) : (
            <EdgeGroup>
              <EdgeRow
                icon={<IconCamera size={18} color={colors.slateDeep} />}
                iconBg="#EEF0FA"
                title="No photos for this wash"
                tone="muted"
              />
            </EdgeGroup>
          )}

          <RateWashCard
            key={wash.id}
            washId={wash.id}
            rating={wash.rating}
            canRate={wash.canRate}
            reviewUrl={byId(wash.branch.id)?.reviewUrl ?? null}
            branchName={wash.branch.name}
          />

          {wash.problems.length > 0 ? (
            <>
              <SectionLabel>Your reports</SectionLabel>
              <EdgeGroup>
                {wash.problems.map((p) => (
                  <ProblemSummary key={p.id} problem={p} />
                ))}
              </EdgeGroup>
            </>
          ) : null}

          <SectionLabel>Need help?</SectionLabel>
          <EdgeGroup>
            <EdgeRow
              icon={<IconAlert size={18} color={colors.amberDeep} />}
              iconBg={colors.amberPale}
              title="Report a problem with this wash"
              subtitle="The branch team sees it and replies here"
              onPress={() =>
                navigation.navigate('ReportProblem', {
                  washId: wash.id,
                  label: `${wash.vehicle.registrationNumber} · ${formatDateTime(wash.createdAt)}`,
                })
              }
            />
          </EdgeGroup>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  loading: { marginTop: spacing.xl },
  content: { paddingBottom: spacing.xl },
  // The summary and the bill are full-width blocks, like every other list on the screen.
  summary: { backgroundColor: colors.white, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, marginTop: 20 },
  summaryClip: { overflow: 'hidden' },
  summaryAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  summaryBody: { paddingVertical: 18, paddingLeft: 22, paddingRight: 18, gap: 4 },
  summaryMeta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13.5 },
  summaryTotal: { ...typography.display, color: colors.ink, fontSize: 36, letterSpacing: -0.8 },
  bill: { backgroundColor: colors.white, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.md },
  billDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 2 },
  billName: { ...typography.body, color: colors.waterInk, flexShrink: 1 },
  billMuted: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  billDiscount: { ...typography.body, color: colors.teal, fontSize: 14 },
  billTotalLabel: { ...typography.bodyStrong, color: colors.waterInk },
  billTotal: { ...typography.heading, color: colors.waterDeep },
  photoGroup: { gap: spacing.sm },
  photoTitle: { ...typography.label, color: colors.slateDeep, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoCell: { width: '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  pressed: { opacity: 0.8 },
});
