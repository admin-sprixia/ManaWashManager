import React, { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PLACE_TYPE_LABEL } from '@mana/domain';
import {
  Button,
  IconBike,
  IconCalendar,
  IconCar,
  IconHome,
  IconPhone,
  IconPlus,
  IconShare,
  Notice,
  colors,
  showAlert,
  showToast,
  spacing,
} from '@mana/ui';
import { API_BASE_URL, api, send } from '../../api/client';
import { errorMessage } from '../../api/errors';
import type { Membership } from '../../api/types';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../../components/CardList';
import { MessageCard } from '../../components/MessageCard';
import { PlaceHeaderCard, placeTitle } from '../../components/places/PlaceCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useRemote } from '../../hooks/useRemote';
import { usePageStyle } from '../../layout/Layout';
import type { MainStackParams } from '../../navigation/types';
import { nextWashOf, PHASE_LABEL, PHASE_TONE, washDayLine } from '../../places/format';
import { callNumber, shareText } from '../../utils/contact';

type Props = NativeStackScreenProps<MainStackParams, 'MyPlace'>;

/** The place the customer lives: their flat, each vehicle and its plan, and the team's number. */
export function MyPlaceScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const remote = useRemote(() => send(api.home.places.$get()));
  const [leaving, setLeaving] = useState(false);
  const m = remote.data?.memberships.find((x) => x.id === route.params.memberId) ?? null;

  const leave = (member: Membership) =>
    showAlert(
      'Moved out?',
      'Your plans here end today. Washes you’ve paid for and not had are refunded as per the plan’s rules.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'I moved out',
          style: 'destructive',
          onPress: () => {
            setLeaving(true);
            send(api.members[':id'].leave.$post({ param: { id: member.id }, json: { reason: 'Moved out' } }))
              .then(() => {
                showToast(`You’ve left ${placeTitle(member.place)}.`, 'success');
                navigation.goBack();
              })
              .catch((err) => showToast(errorMessage(err), 'error'))
              .finally(() => setLeaving(false));
          },
        },
      ],
      { plain: true },
    );

  if (!m) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <ScreenHeader title="My place" onBack={() => navigation.goBack()} />
        {remote.loading ? (
          <ActivityIndicator style={styles.loading} color={colors.water} size="large" />
        ) : (
          <MessageCard
            title={remote.error ? 'Couldn’t open your place' : 'You’re not at this place any more'}
            body={remote.error ?? 'Find your place again to join it.'}
            action={
              remote.error
                ? { label: 'Try again', onPress: () => void remote.reload() }
                : { label: 'Find my place', onPress: () => navigation.replace('FindPlace') }
            }
          />
        )}
      </SafeAreaView>
    );
  }

  const noun = m.place.type === 'building' ? 'Flat' : 'House';
  const next = nextWashOf(m.vehicles.flatMap((v) => (v.orders[0] ? [v.orders[0]] : [])));

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title={placeTitle(m.place)} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.content, pageStyle]}
        refreshControl={<RefreshControl refreshing={remote.refreshing} onRefresh={() => void remote.reload()} />}
      >
        <PlaceHeaderCard place={m.place} branchName={m.branch.name} />

        {m.status === 'pending' ? (
          <View style={styles.pad}>
            <Notice tone="warning" title="Waiting for the team">
              The team will confirm and call you. You can pay once they do.
            </Notice>
          </View>
        ) : null}

        <SectionLabel>Your home</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconHome size={18} color={colors.indigo} />}
            title={`${noun} ${m.unit}`}
            subtitle={m.parkingNote ?? PLACE_TYPE_LABEL[m.place.type]}
          />
          {next ? (
            <EdgeRow icon={<IconCalendar size={18} color={colors.indigo} />} title={`Next wash day ${washDayLine(next, m.place.washTime)}`} />
          ) : null}
        </EdgeGroup>

        <SectionLabel>Vehicles</SectionLabel>
        <EdgeGroup>
          {m.vehicles.map((v) => {
            const order = v.orders[0];
            return (
              <EdgeRow
                key={v.id}
                icon={v.category === 'bike' ? <IconBike size={18} color={colors.indigo} /> : <IconCar size={18} color={colors.indigo} />}
                title={v.vehicle?.registrationNumber ?? v.typeName}
                subtitle={order ? (order.renewalDue ? `${order.title} · ending soon` : order.title) : 'No plan yet'}
                right={order ? <Pill label={PHASE_LABEL[order.phase].toUpperCase()} tone={PHASE_TONE[order.phase]} /> : undefined}
                onPress={order ? () => navigation.navigate('Plan', { orderId: order.id }) : undefined}
              />
            );
          })}
          {m.status === 'active' ? (
            <EdgeRow
              icon={<IconPlus size={18} color={colors.indigo} />}
              title="Add a vehicle"
              onPress={() => navigation.navigate('JoinPlace', { placeId: m.place.id })}
            />
          ) : null}
        </EdgeGroup>

        <SectionLabel>Help</SectionLabel>
        <EdgeGroup>
          {m.branch.phone ? (
            <EdgeRow
              icon={<IconPhone size={18} color={colors.indigo} />}
              title={`Call ${m.branch.name}`}
              onPress={() => callNumber(m.branch.phone!)}
            />
          ) : null}
          <EdgeRow
            icon={<IconShare size={18} color={colors.indigo} />}
            title="Invite neighbours"
            subtitle="They join your place in a minute."
            onPress={() =>
              void shareText(`We get our cars washed at ${placeTitle(m.place)} with MANA Car Wash. Join here: ${API_BASE_URL}/p/${m.place.code}`)
            }
          />
        </EdgeGroup>

        <View style={styles.actions}>
          <Button label="I moved out" variant="ghost" loading={leaving} onPress={() => leave(m)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
  pad: { paddingHorizontal: 16, paddingTop: 16 },
  actions: { paddingHorizontal: 16, paddingTop: spacing.lg },
});
