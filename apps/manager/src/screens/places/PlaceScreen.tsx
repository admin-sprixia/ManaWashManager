import React, { useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { describeWashDays, formatClock, formatDay, MEMBER_CHECK_LABEL } from '@mana/domain';
import {
  Button,
  EdgeGroup,
  EdgeRow,
  EdgePanel,
  IconBike,
  IconCalendar,
  IconCar,
  IconEdit,
  IconGrid,
  IconImage,
  IconShare,
  IconUserPlus,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  colors,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { API_BASE_URL, api } from '../../api/client';
import { useAuth } from '../../api/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { InspectionSummary, PhotoStrip } from './communityParts';
import { MemberSheet } from './MemberSheet';
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

const STATUS_PILL = { active: null, paused: { label: 'PAUSED', tone: 'slate' }, closed: { label: 'CLOSED', tone: 'slate' } } as const;
const STAGE_PILL = { draft: { label: 'DRAFT', tone: 'slate' }, review: { label: 'TO APPROVE', tone: 'amber' }, live: null } as const;

function memberSubtitle(m: PlaceMember): string {
  if (m.status === 'pending') return m.checks.length ? m.checks.map((c) => MEMBER_CHECK_LABEL[c]).join(' · ') : 'To confirm';
  return m.vehicles.map((v) => v.vehicle?.registrationNumber ?? v.typeName).join(', ') || 'No vehicles';
}

/** One place for the team: its wash day, members (confirm, pay links, remove), flats, poster and setup. */
export function PlaceScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const { isOwner } = useAuth();
  const detail = useApiData<PlaceDetail>(() => api.places[':id'].$get({ param: { id: placeId } }), 'Couldn’t load this place.');
  const members = useApiData<{ members: PlaceMember[] }>(
    () => api.places[':id'].members.$get({ param: { id: placeId }, query: { filter: 'live' } }),
    'Couldn’t load the members.',
  );
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [unitsOpen, setUnitsOpen] = useState(false);

  const place = detail.data?.place ?? null;
  const list = members.data?.members ?? [];
  const pending = list.filter((m) => m.status === 'pending');
  const active = list.filter((m) => m.status === 'active');
  const member = list.find((m) => m.id === openMember) ?? null;

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
          <ScreenHeader title="Place" onBack={() => navigation.goBack()} />
        </View>
        {detail.error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{detail.error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void detail.load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const noun = place.type === 'building' ? 'Flat' : 'House';
  const nextDay = place.nextWashDays[0];
  const status = place.stage === 'live' ? STATUS_PILL[place.status] : STAGE_PILL[place.stage];
  const joinLink = `${API_BASE_URL}/p/${place.code}`;
  const setup = place.setup;

  if (place.stage !== 'live') {
    const canEdit = isOwner || place.stage === 'draft';
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={placeTitle(place)} onBack={() => navigation.goBack()} right={status ? <Pill label={status.label} tone={status.tone} /> : undefined} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={refresh} />}>
          <View style={styles.pad}>
            {place.status === 'closed' ? (
              <Notice>This draft was dropped.</Notice>
            ) : place.stage === 'review' ? (
              <Notice title={isOwner ? 'Waiting for your approval' : 'With the owner'}>
                {isOwner
                  ? 'Check what the visit found, pick the days, time and team, then make it live.'
                  : 'The owner will pick the final days and team. Customers can join once it’s live.'}
              </Notice>
            ) : setup.reviewNote ? (
              <Notice tone="warning" title="Sent back by the owner">
                {setup.reviewNote}
              </Notice>
            ) : (
              <Notice>Draft. Customers can’t see it yet. Fill in what you found and send it for approval.</Notice>
            )}
          </View>
          <SectionLabel>What the visit found</SectionLabel>
          <EdgePanel style={styles.summary}>
            <Text style={styles.kind}>{placeKindLine(place)}</Text>
            {setup.createdBy ? <Text style={styles.code}>Inspected by {setup.createdBy.name}</Text> : null}
            <InspectionSummary inspection={setup.inspection} slots={setup.slots} contactName={setup.contactName} contactPhone={setup.contactPhone} notes={setup.notes} />
            {place.photos.length ? <PhotoStrip placeId={placeId} photos={place.photos} /> : null}
          </EdgePanel>
          {place.status !== 'closed' ? (
            <View style={styles.actions}>
              {isOwner ? <Button label="Review and approve" size="lg" onPress={() => navigation.navigate('PlaceForm', { placeId })} /> : null}
              {canEdit ? (
                <Button
                  label={place.stage === 'draft' ? 'Continue the draft' : 'Edit what the visit found'}
                  variant={isOwner ? 'secondary' : 'primary'}
                  size={isOwner ? undefined : 'lg'}
                  onPress={() => navigation.navigate('CommunitySetup', { placeId })}
                />
              ) : null}
              {isOwner ? <Button label="Drop this community" variant="ghost" onPress={() => dropDraft()} /> : null}
            </View>
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      </ScreenContainer>
    );
  }

  const memberRow = (m: PlaceMember) => {
    const order = m.vehicles.flatMap((v) => (v.orders[0] ? [v.orders[0]] : []))[0];
    return (
      <EdgeRow
        key={m.id}
        icon={m.vehicles[0]?.category === 'bike' ? <IconBike size={18} color={colors.waterDeep} /> : <IconCar size={18} color={colors.waterDeep} />}
        title={`${m.unit} · ${m.customer.name ?? m.customer.phone}`}
        subtitle={memberSubtitle(m)}
        right={
          m.status === 'pending' ? (
            <Pill label="CONFIRM" tone="danger" />
          ) : order ? (
            <Pill label={PHASE_STAFF_LABEL[order.phase].toUpperCase()} tone={PHASE_STAFF_TONE[order.phase]} />
          ) : undefined
        }
        onPress={() => setOpenMember(m.id)}
      />
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={placeTitle(place)} onBack={() => navigation.goBack()} right={status ? <Pill label={status.label} tone={status.tone} /> : undefined} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={refresh} />}>
        <EdgePanel style={styles.summary}>
          <Text style={styles.kind}>{placeKindLine(place)}</Text>
          <Text style={styles.line}>
            {describeWashDays(place.washDays)} · {formatClock(place.washTime)}
          </Text>
          <Text style={styles.code}>
            {setup.team.length ? `Team: ${setup.team.map((t) => t.name).join(', ')} · ` : ''}Code {place.code}
          </Text>
        </EdgePanel>

        <SectionLabel>Wash day</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconCalendar size={18} color={colors.waterDeep} />}
            title={nextDay ? `Next wash · ${formatDay(nextDay)}` : 'No wash day set'}
            subtitle="Who to wash, paid or not"
            onPress={nextDay ? () => navigation.navigate('PlaceDay', { placeId, day: nextDay }) : undefined}
          />
        </EdgeGroup>

        {pending.length ? (
          <>
            <SectionLabel>To confirm</SectionLabel>
            <EdgeGroup>{pending.map(memberRow)}</EdgeGroup>
          </>
        ) : null}

        <SectionLabel right={active.length ? `${active.length}` : undefined}>Members</SectionLabel>
        <EdgeGroup>
          {active.map(memberRow)}
          <EdgeRow
            icon={<IconUserPlus size={18} color={colors.waterDeep} />}
            title="Add a member"
            subtitle="For someone without a smartphone"
            onPress={() => navigation.navigate('AddMember', { placeId })}
          />
        </EdgeGroup>
        {members.error ? <Text style={[styles.error, styles.pad]}>{members.error}</Text> : null}

        <SectionLabel>Get members</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconGrid size={18} color={colors.waterDeep} />}
            title="QR poster"
            subtitle="Print it for the notice board or lift"
            onPress={() => void Linking.openURL(`${joinLink}/poster`).catch(() => undefined)}
          />
          <EdgeRow
            icon={<IconShare size={18} color={colors.waterDeep} />}
            title="Share the join link"
            subtitle="For the residents’ WhatsApp group"
            onPress={() =>
              void Share.share({
                message: `Car wash at ${placeTitle(place)}, ${describeWashDays(place.washDays).toLowerCase()} morning. Join in a minute: ${joinLink}`,
              }).catch(() => undefined)
            }
          />
        </EdgeGroup>

        <SectionLabel>Setup</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconImage size={18} color={colors.waterDeep} />}
            title="Inspection & photos"
            subtitle={`${place.photos.length} photo${place.photos.length === 1 ? '' : 's'}${setup.notes ? ' · notes' : ''}${setup.contactPhone ? ' · contact' : ''}`}
            onPress={() => navigation.navigate('CommunitySetup', { placeId })}
          />
          {isOwner ? (
            <>
              <EdgeRow
                icon={<IconGrid size={18} color={colors.waterDeep} />}
                title={`${noun}s`}
                subtitle={detail.data?.units.length ? `${detail.data.units.length} on the list` : `Add the ${noun.toLowerCase()} numbers`}
                onPress={() => setUnitsOpen(true)}
              />
              <EdgeRow
                icon={<IconEdit size={18} color={colors.waterDeep} />}
                title="Wash settings"
                subtitle="Days, time, team, approval, pause or close"
                onPress={() => navigation.navigate('PlaceForm', { placeId })}
              />
            </>
          ) : null}
        </EdgeGroup>
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
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  summary: { gap: 4 },
  actions: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, gap: spacing.sm },
  kind: { ...typography.label, color: colors.slateDeep },
  line: { ...typography.bodyStrong, color: colors.waterInk },
  code: { ...typography.caption, color: colors.slate, letterSpacing: 1 },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
