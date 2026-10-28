import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { describeWashDays, formatClock, formatDay, joinWords, MEMBER_CHECK_LABEL, WEEKDAY_SHORT, weekdayOf } from '@mana/domain';
import {
  Button,
  IconChevronRight,
  IconEdit,
  IconGrid,
  IconImage,
  IconSearch,
  IconShare,
  IconUserPlus,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  colors,
  radius,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { API_BASE_URL, api } from '../../api/client';
import { useAuth } from '../../api/auth';
import { Band, BandRow, ScreenHero } from '../../components/ScreenChrome';
import { BoardSectionHeader } from '../../components/board/BoardSectionHeader';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { ActionTile, FormSection, StageTrack, StickyActions, TileRow, UnitTile } from './kit';
import { VisitReport } from './visit/VisitReport';
import { MemberSheet } from './MemberSheet';
import { ActionPill, Chip, PanelRow, QuietRow, TEAL, TEAL_MIST, TEAL_PALE, plural } from './panel/parts';
import {
  PHASE_STAFF_LABEL,
  PHASE_STAFF_TONE,
  placeKindLine,
  placeTitle,
  toastOnError,
  useApiData,
  type PlaceDetail,
  type PlaceMember,
} from './shared';
import { UnitsSheet } from './UnitsSheet';

type Props = NativeStackScreenProps<RootStackParamList, 'Place'>;

const UNPAID = new Set(['awaiting_payment', 'payment_due', 'paused_unpaid']);

const memberName = (m: PlaceMember) => m.customer.name?.trim() || `+91 ${m.customer.phone}`;
const memberUnpaid = (m: PlaceMember) => m.vehicles.some((v) => v.orders[0] && UNPAID.has(v.orders[0].phase));
const vehiclesLine = (m: PlaceMember) => m.vehicles.map((v) => v.vehicle?.registrationNumber ?? v.typeName).join(', ') || 'No vehicles';

/** One community for the team: its wash days, members (confirm, pay links, remove), flats, poster and setup. */
export function PlaceScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const { isOwner } = useAuth();
  const detail = useApiData<PlaceDetail>(() => api.places[':id'].$get({ param: { id: placeId } }), 'Couldn’t load this community.');
  const members = useApiData<{ members: PlaceMember[] }>(
    () => api.places[':id'].members.$get({ param: { id: placeId }, query: { filter: 'live' } }),
    'Couldn’t load the members.',
  );
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const place = detail.data?.place ?? null;
  const list = members.data?.members ?? [];
  const pending = list.filter((m) => m.status === 'pending');
  const active = list.filter((m) => m.status === 'active');
  const member = list.find((m) => m.id === openMember) ?? null;
  const unpaid = active.filter(memberUnpaid).length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter((m) => `${m.unit} ${m.customer.name ?? ''} ${m.customer.phone} ${vehiclesLine(m)}`.toLowerCase().includes(q));
  }, [active, search]);

  const refresh = () => void Promise.all([detail.refresh(), members.refresh()]);

  const dropDraft = () =>
    showAlert('Drop this community?', 'It won’t go live. You can find it later under closed communities.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Drop',
        style: 'destructive',
        onPress: () =>
          void toastOnError(detail.run(() => api.places[':id'].$patch({ param: { id: placeId }, json: { status: 'closed' } }), 'Dropped')).then(
            (ok) => ok && navigation.goBack(),
          ),
      },
    ]);

  if (!place) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Community" onBack={() => navigation.goBack()} />
        </View>
        {detail.error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{detail.error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void detail.load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.teal} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const noun = place.type === 'building' ? 'Flat' : 'House';
  const setup = place.setup;
  const joinLink = `${API_BASE_URL}/p/${place.code}`;
  const team = setup.team.map((t) => t.name);

  // ─── Not live yet: where it is on the way, and what the visit found ───────────
  if (place.stage !== 'live') {
    const dropped = place.status === 'closed';
    const canEdit = isOwner || place.stage === 'draft';
    const sentBack = place.stage === 'draft' && setup.reviewNote;
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={place.stage === 'review' ? 'Waiting for approval' : 'Community draft'} onBack={() => navigation.goBack()} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={refresh} />}>
          <ScreenHero
            tone={dropped ? 'brand' : sentBack ? 'alert' : 'teal'}
            eyebrow={placeKindLine(place)}
            title={placeTitle(place)}
            meta={
              dropped
                ? 'This draft was dropped.'
                : place.stage === 'review'
                  ? isOwner
                    ? 'Check what the visit found, pick the days, time and team, then make it live.'
                    : 'With the owner. Customers can join once it’s live.'
                  : sentBack
                    ? `Sent back: ${setup.reviewNote}`
                    : 'Customers can’t see it yet. Finish it and send it to the owner.'
            }
            chips={[
              { label: 'Photos', value: place.photos.length },
              { label: 'Still to add', value: setup.missing.length },
              { label: 'By', value: setup.createdBy?.name.split(' ')[0] ?? '—' },
            ]}
          />

          <View style={styles.trackBand}>
            <StageTrack stage={place.stage} />
          </View>

          <FormSection icon={<IconImage size={14} color={TEAL} />} title="What the visit found" caption={setup.createdBy ? `Inspected by ${setup.createdBy.name}` : undefined}>
            <VisitReport setup={setup} placeId={placeId} photos={place.photos} location={place.location} />
          </FormSection>
          <View style={styles.bottomPad} />
        </ScrollView>

        {!dropped ? (
          <StickyActions>
            {isOwner && place.stage === 'review' ? (
              <Button label="Review and approve" size="lg" onPress={() => navigation.navigate('PlaceForm', { placeId })} />
            ) : null}
            {canEdit ? (
              <Button
                label={place.stage === 'draft' ? (sentBack ? 'Fix and resend' : 'Continue the draft') : 'Edit what the visit found'}
                variant={isOwner && place.stage === 'review' ? 'secondary' : 'primary'}
                size={isOwner && place.stage === 'review' ? undefined : 'lg'}
                onPress={() => navigation.navigate('CommunitySetup', { placeId })}
              />
            ) : null}
            {isOwner ? <Button label="Drop this community" variant="ghost" onPress={() => dropDraft()} /> : null}
          </StickyActions>
        ) : null}
      </ScreenContainer>
    );
  }

  // ─── Live ─────────────────────────────────────────────────────────────────────
  const statusPill =
    place.status === 'paused' ? <Pill label="PAUSED" tone="amber" /> : place.status === 'closed' ? <Pill label="CLOSED" tone="slate" /> : null;

  const memberRow = (m: PlaceMember, i: number) => {
    const order = m.vehicles.flatMap((v) => (v.orders[0] ? [v.orders[0]] : []))[0];
    const isPending = m.status === 'pending';
    return (
      <PanelRow
        key={m.id}
        first={i === 0}
        leading={<UnitTile unit={m.unit} tone={isPending ? 'danger' : order && UNPAID.has(order.phase) ? 'slate' : 'teal'} />}
        title={memberName(m)}
        meta={isPending ? (m.checks.length ? m.checks.map((c) => MEMBER_CHECK_LABEL[c]).join(' · ') : 'Joined · waiting for you') : vehiclesLine(m)}
        right={
          isPending ? (
            <ActionPill label="Confirm" onPress={() => setOpenMember(m.id)} />
          ) : order ? (
            <Pill label={PHASE_STAFF_LABEL[order.phase].toUpperCase()} tone={PHASE_STAFF_TONE[order.phase]} />
          ) : (
            <IconChevronRight size={18} color={colors.slate} />
          )
        }
        footer={
          !isPending && order && order.kind === 'plan' ? (
            <Chip label={`${order.title} · ${order.washesUsed}/${order.washesTotal} washes`} tone="teal" />
          ) : !isPending && order ? (
            <Chip label={order.title} tone="slate" />
          ) : null
        }
        onPress={() => setOpenMember(m.id)}
      />
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Community" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={detail.refreshing || members.refreshing} onRefresh={refresh} />}
      >
        <ScreenHero
          tone={place.status === 'active' ? 'teal' : 'brand'}
          eyebrow={placeKindLine(place)}
          title={placeTitle(place)}
          meta={[`${describeWashDays(place.washDays)} · ${formatClock(place.washTime)}`, team.length ? `Team: ${team.join(', ')}` : 'No team set']
            .filter(Boolean)
            .join('\n')}
          right={statusPill ?? <Text style={styles.code}>{place.code}</Text>}
          chips={[
            { label: 'Members', value: active.length },
            { label: 'To confirm', value: pending.length },
            { label: 'Not paid', value: unpaid },
            { label: `${noun}s`, value: detail.data?.units.length ?? 0 },
          ]}
        />

        {/* Next wash days */}
        <BoardSectionHeader title="Next wash days" />
        {place.nextWashDays.length ? (
          place.nextWashDays.map((d, i) => (
            <PanelRow
              key={d}
              first={i === 0}
              leading={
                <View style={[styles.dateTile, i === 0 && styles.dateTileNext]}>
                  <Text style={[styles.dateDay, i === 0 && styles.dateOn]}>{WEEKDAY_SHORT[weekdayOf(d)]}</Text>
                  <Text style={[styles.dateNum, i === 0 && styles.dateOn]}>{Number(d.slice(8))}</Text>
                </View>
              }
              title={i === 0 ? `Next · ${formatDay(d)}` : formatDay(d)}
              meta={`${formatClock(place.washTime)} · who to wash, paid or not`}
              right={i === 0 ? <ActionPill label="Open list" onPress={() => navigation.navigate('PlaceDay', { placeId, day: d })} /> : <IconChevronRight size={18} color={colors.slate} />}
              onPress={() => navigation.navigate('PlaceDay', { placeId, day: d })}
            />
          ))
        ) : (
          <QuietRow first title="No wash days set" body={isOwner ? 'Pick the days in Wash settings below.' : 'The owner picks the days.'} />
        )}

        {/* Get members */}
        <BoardSectionHeader title="Get members" />
        {joinWords(detail.data?.join ?? null) ? (
          <View style={styles.join}>
            <Text style={styles.joinText}>{joinWords(detail.data!.join)!.now}</Text>
            {joinWords(detail.data!.join)!.next ? <Text style={styles.joinNext}>{joinWords(detail.data!.join)!.next}</Text> : null}
          </View>
        ) : null}
        <TileRow>
          <ActionTile
            icon={<IconGrid size={19} color={TEAL} />}
            label="QR poster"
            caption="Print for the lift or notice board"
            onPress={() => void Linking.openURL(`${joinLink}/poster`).catch(() => undefined)}
          />
          <ActionTile
            icon={<IconShare size={19} color={TEAL} />}
            label="Share link"
            caption="For the residents’ WhatsApp group"
            onPress={() =>
              void Share.share({
                message: `Car wash at ${placeTitle(place)}, ${describeWashDays(place.washDays).toLowerCase()} at ${formatClock(place.washTime)}. Join in a minute: ${joinLink}`,
              }).catch(() => undefined)
            }
          />
          <ActionTile
            icon={<IconUserPlus size={19} color={TEAL} />}
            label="Add member"
            caption="Someone without a smartphone"
            onPress={() => navigation.navigate('AddMember', { placeId })}
          />
        </TileRow>

        {/* To confirm */}
        {pending.length ? (
          <>
            <BoardSectionHeader title="To confirm" count={pending.length} tone="alert" />
            {pending.map(memberRow)}
          </>
        ) : null}

        {/* Members */}
        <BoardSectionHeader title="Members" count={active.length || undefined} />
        {active.length > 8 ? (
          <View style={styles.searchWrap}>
            <IconSearch size={17} color={colors.slate} />
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder={`Search by ${noun.toLowerCase()}, name or plate`}
              placeholderTextColor={colors.slate}
              accessibilityLabel="Search members"
              disableFullscreenUI
            />
          </View>
        ) : null}
        {shown.length ? (
          shown.map(memberRow)
        ) : (
          <QuietRow
            first
            title={search ? 'Nobody matches' : 'No members yet'}
            body={search ? 'Try a flat number, name or plate.' : 'Share the link or put up the QR poster to get the first ones.'}
          />
        )}
        {members.error ? <Text style={[styles.error, styles.pad]}>{members.error}</Text> : null}

        {/* Setup */}
        <BoardSectionHeader title="Setup" />
        <Band>
          <BandRow
            icon={<IconImage size={18} color={TEAL} />}
            iconBg={TEAL_PALE}
            title="Inspection & photos"
            subtitle={[plural(place.photos.length, 'photo'), setup.notes ? 'notes' : null, setup.contactPhone ? 'contact' : null].filter(Boolean).join(' · ')}
            right={<IconChevronRight size={18} color={colors.slate} />}
            last={!isOwner}
            onPress={() => navigation.navigate('CommunitySetup', { placeId })}
          />
          {isOwner ? (
            <>
              <BandRow
                icon={<IconGrid size={18} color={TEAL} />}
                iconBg={TEAL_PALE}
                title={`${noun}s`}
                subtitle={detail.data?.units.length ? `${detail.data.units.length} on the list people pick from` : `Add the ${noun.toLowerCase()} numbers people pick from`}
                right={<IconChevronRight size={18} color={colors.slate} />}
                onPress={() => setUnitsOpen(true)}
              />
              <BandRow
                icon={<IconEdit size={18} color={colors.indigo} />}
                iconBg={colors.indigoPale}
                title="Wash settings"
                subtitle="Days, time, team, who can join, pause or close"
                right={<IconChevronRight size={18} color={colors.slate} />}
                last
                onPress={() => navigation.navigate('PlaceForm', { placeId })}
              />
            </>
          ) : null}
        </Band>
        <View style={styles.bottomPad} />
      </ScrollView>

      <MemberSheet member={member} noun={noun} onClose={() => setOpenMember(null)} run={members.run} reload={members.load} />
      {detail.data ? (
        <UnitsSheet
          visible={unitsOpen}
          placeId={placeId}
          units={detail.data.units}
          noun={noun}
          onClose={() => setUnitsOpen(false)}
          run={detail.run}
          members={list}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  join: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm + 4,
    gap: 2,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  joinText: { ...typography.label, fontSize: 13.5, lineHeight: 19, fontWeight: '700', color: '#065F46' },
  joinNext: { ...typography.caption, fontSize: 12.5, lineHeight: 17, color: '#047857', letterSpacing: 0 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  error: { ...typography.label, color: colors.danger, marginTop: spacing.sm },
  bottomPad: { height: spacing.xxl },
  code: {
    ...typography.label,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  trackBand: {
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  dateTile: { width: 46, height: 46, borderRadius: 15, backgroundColor: TEAL_MIST, alignItems: 'center', justifyContent: 'center' },
  dateTileNext: { backgroundColor: TEAL },
  dateDay: { ...typography.caption, fontSize: 10.5, fontWeight: '800', color: colors.slate, letterSpacing: 0.4 },
  dateNum: { ...typography.heading, fontSize: 17, color: colors.waterInk, lineHeight: 20 },
  dateOn: { color: colors.white },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  search: { flex: 1, paddingVertical: 9, ...typography.body, fontSize: 15, color: colors.waterInk },
});
