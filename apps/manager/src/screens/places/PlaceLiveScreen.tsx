import React from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { describeWashDays, formatDay } from '@mana/domain';
import { Button, IconCheck, IconGrid, IconShare, IconUserPlus, IconUsers, ScreenContainer, colors, spacing, typography } from '@mana/ui';
import { API_BASE_URL, api } from '../../api/client';
import { ScreenHero } from '../../components/ScreenChrome';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { ActionTile, TileRow } from './kit';
import { TEAL, TEAL_PALE } from './panel/parts';
import { time12 } from './review/options';
import { placeTitle, useApiData, type PlaceDetail } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaceLive'>;

/** Straight after approving: it's live, who was invited, and the first things to do to get members. */
export function PlaceLiveScreen({ navigation, route }: Props) {
  const { placeId, invited } = route.params;
  const detail = useApiData<PlaceDetail>(() => api.places[':id'].$get({ param: { id: placeId } }), 'Couldn’t load the community.');
  const place = detail.data?.place ?? null;

  if (!place) {
    return (
      <ScreenContainer noPadding>
        <ActivityIndicator color={colors.teal} style={styles.loading} />
      </ScreenContainer>
    );
  }

  const joinLink = `${API_BASE_URL}/p/${place.code}`;
  const first = place.nextWashDays[0];
  const units = detail.data?.units.length ?? 0;
  const noun = place.type === 'building' ? 'flat' : 'house';

  return (
    <ScreenContainer noPadding>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenHero
          tone="teal"
          eyebrow="Approved"
          title="It’s live!"
          meta={`${placeTitle(place)} · ${describeWashDays(place.washDays)} at ${time12(place.washTime)}${first ? `\nFirst wash day: ${formatDay(first)}` : ''}`}
          right={
            <View style={styles.tick}>
              <IconCheck size={22} color={TEAL} />
            </View>
          }
        />

        <View style={styles.stats}>
          <View style={[styles.stat, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
            <Text style={[styles.statValue, { color: '#15803D' }]}>{invited}</Text>
            <Text style={styles.statLabel}>{invited === 1 ? 'person nearby invited' : 'people nearby invited'}</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' }]}>
            <Text style={[styles.statValue, { color: '#0369A1' }]}>{units}</Text>
            <Text style={styles.statLabel}>{`${noun}s on the list`}</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}>
            <Text style={[styles.statValue, { color: '#6D28D9' }]}>{place.setup.team.length}</Text>
            <Text style={styles.statLabel}>in the team</Text>
          </View>
        </View>

        <Text style={styles.section}>Get your first members</Text>
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
            caption="Send to the residents’ WhatsApp group"
            onPress={() =>
              void Share.share({
                message: `Car wash at ${placeTitle(place)}, ${describeWashDays(place.washDays).toLowerCase()} at ${time12(place.washTime)}. Join in a minute: ${joinLink}`,
              }).catch(() => undefined)
            }
          />
          <ActionTile
            icon={<IconUserPlus size={19} color={TEAL} />}
            label="Add member"
            caption="For someone without a smartphone"
            onPress={() => navigation.navigate('AddMember', { placeId })}
          />
        </TileRow>

        {!units ? (
          <View style={styles.tip}>
            <IconUsers size={16} color={colors.amberDeep} />
            <Text style={styles.tipText}>Add the {noun} numbers so residents can pick theirs when they join.</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label="Open the community" size="lg" onPress={() => navigation.replace('Place', { placeId })} />
          <Button label="Back to home" variant="ghost" onPress={() => navigation.popToTop()} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  tick: { width: 44, height: 44, borderRadius: 22, backgroundColor: TEAL_PALE, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  stat: { flex: 1, padding: spacing.sm + 4, borderRadius: 18, borderWidth: 1, gap: 2 },
  statValue: { ...typography.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 16 },
  section: { ...typography.heading, fontSize: 16, color: colors.ink, paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: 14,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  tipText: { ...typography.label, fontSize: 13, color: colors.amberDeep, fontWeight: '700', flex: 1 },
  actions: { paddingHorizontal: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
});
