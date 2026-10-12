import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { describeSlot, PLACE_CAPACITY_MAX, REVIEW_NOTE_MAX, sortWeekdays, type PlaceStatus } from '@mana/domain';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgePanel,
  Notice,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { ToggleChips } from '../business/shared';
import { DAY_OPTIONS, InspectionSummary, PhotoStrip, TimeChips } from './communityParts';
import { failure, placeTitle, useApiData, type PlaceDetail, type TeamUser } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaceForm'>;

const APPROVAL = [
  { value: 'no', label: 'Anyone can join' },
  { value: 'yes', label: 'We confirm each member' },
] as const;
const STATUS_OPTIONS: { value: PlaceStatus; label: string }[] = [
  { value: 'active', label: 'Washing' },
  { value: 'paused', label: 'Paused' },
  { value: 'closed', label: 'Closed' },
];

/**
 * The owner's side of a community: reviewing a draft (what the visit found, photos, the days
 * residents asked for) and making it live with the final days, time and team — or sending it
 * back. For a live community: changing its days, team, approval, capacity, or pausing it.
 */
export function PlaceFormScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const detail = useApiData<PlaceDetail>(() => api.places[':id'].$get({ param: { id: placeId } }), 'Couldn’t load this community.');
  const team = useApiData<{ users: TeamUser[] }>(() => api.places.team.$get(), 'Couldn’t load the team.');
  const place = detail.data?.place ?? null;
  const live = place?.stage === 'live';

  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState('06:30');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [approval, setApproval] = useState<'yes' | 'no'>('no');
  const [capacity, setCapacity] = useState('');
  const [status, setStatus] = useState<PlaceStatus>('active');
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!place || filled) return;
    setFilled(true);
    const first = place.setup.slots[0];
    // A draft's days stand in for the 1st choice; the owner starts from what residents asked.
    setDays((live || !first ? place.washDays : first.days).map(String));
    setTime(live || !first ? place.washTime : first.time);
    setTeamIds(place.setup.team.map((t) => t.id));
    setApproval(place.needsApproval ? 'yes' : 'no');
    setCapacity(place.capacity != null ? String(place.capacity) : '');
    setStatus(place.status);
  }, [place, filled, live]);

  const settings = () => {
    const cap = capacity.trim() ? Number(capacity) : null;
    if (!days.length) throw new Error('Pick at least one wash day.');
    if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > PLACE_CAPACITY_MAX)) {
      throw new Error(`Vehicles per wash day is 1 to ${PLACE_CAPACITY_MAX}, or leave it empty.`);
    }
    return { washDays: days.map(Number).sort(), washTime: time, needsApproval: approval === 'yes', capacity: cap };
  };

  const submit = async () => {
    setError(null);
    let values;
    try {
      values = settings();
    } catch (e) {
      return setError((e as Error).message);
    }
    setBusy(true);
    try {
      if (live) {
        const [a, b] = await Promise.all([
          api.places[':id'].$patch({ param: { id: placeId }, json: { ...values, status } }),
          api.places[':id'].team.$put({ param: { id: placeId }, json: { userIds: teamIds } }),
        ]);
        if (!a.ok) return setError(await apiErrorMessage(a, 'Couldn’t save.'));
        if (!b.ok) return setError(await apiErrorMessage(b, 'Couldn’t save the team.'));
        showToast('Saved', 'success');
        navigation.goBack();
      } else {
        const res = await api.places[':id']['go-live'].$post({ param: { id: placeId }, json: { ...values, teamUserIds: teamIds } });
        if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t make it live.'));
        const { invited } = await res.json();
        showToast(invited ? `Live · ${invited} people nearby invited to join` : 'Live · customers can join now', 'success');
        navigation.goBack();
      }
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async () => {
    if (note.trim().length < 3) return setNoteError('Say what needs fixing.');
    setNoteError(null);
    const message = await detail.run(() => api.places[':id']['send-back'].$post({ param: { id: placeId }, json: { note: note.trim() } }), 'Sent back');
    if (message) return setNoteError(message);
    setBackOpen(false);
    navigation.goBack();
  };

  const title = live ? 'Wash settings' : 'Review community';
  if (!place) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={title} onBack={() => navigation.goBack()} />
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

  const users = team.data?.users ?? [];
  const setup = place.setup;
  const picked = sortWeekdays(days.map(Number)).join();
  const chosenSlot = setup.slots.findIndex((s) => s.time === time && sortWeekdays(s.days).join() === picked);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={live ? title : placeTitle(place)} onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!live ? (
            <>
              <View style={styles.pad}>
                {place.stage === 'draft' ? (
                  <Notice tone="warning">Not sent for approval yet. You can still approve it if you checked it yourself.</Notice>
                ) : null}
                {setup.missing.length ? <Notice tone="warning" title="Not filled in">{setup.missing.join(', ')}</Notice> : null}
              </View>
              <SectionLabel>What the visit found</SectionLabel>
              <EdgePanel style={styles.panel}>
                {setup.createdBy ? <Text style={styles.by}>Inspected by {setup.createdBy.name}</Text> : null}
                <InspectionSummary
                  inspection={setup.inspection}
                  slots={setup.slots}
                  contactName={setup.contactName}
                  contactPhone={setup.contactPhone}
                  notes={setup.notes}
                />
                {place.photos.length ? <PhotoStrip placeId={placeId} photos={place.photos} /> : null}
              </EdgePanel>
            </>
          ) : null}

          <SectionLabel>Wash days</SectionLabel>
          <EdgePanel style={styles.panel}>
            {!live && setup.slots.length > 1 ? (
              <ChoiceChips
                label="Start from"
                options={setup.slots.map((s, i) => ({ value: String(i), label: describeSlot(s) }))}
                value={chosenSlot >= 0 ? String(chosenSlot) : null}
                onChange={(i) => {
                  const s = setup.slots[Number(i)]!;
                  setDays(s.days.map(String));
                  setTime(s.time);
                }}
              />
            ) : null}
            <ToggleChips label="Days" options={DAY_OPTIONS} value={days} onChange={setDays} min={1} hint="Weekly plans wash on the first of these each week." />
            <TimeChips label="Time" value={time} onChange={setTime} />
          </EdgePanel>

          <SectionLabel right={teamIds.length ? `${teamIds.length}` : undefined}>Team</SectionLabel>
          <EdgePanel style={styles.panel}>
            {users.length ? (
              <ToggleChips
                label="Who washes here"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                value={teamIds}
                onChange={setTeamIds}
                hint="They see this community on their wash days. Anyone on the team can still record washes."
              />
            ) : (
              <Text style={styles.help}>{team.error ?? 'Loading the team…'}</Text>
            )}
          </EdgePanel>

          <SectionLabel>Members</SectionLabel>
          <EdgePanel style={styles.panel}>
            <ChoiceChips label="Who can join" options={APPROVAL} value={approval} onChange={setApproval} />
            <TextField
              label="Vehicles per wash day"
              optional
              value={capacity}
              onChangeText={(t) => setCapacity(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder="No limit"
              hint="Two washers do about 8–10 cars in a morning. When full, new members start on the next wash day with room."
            />
            {live ? <ChoiceChips label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} /> : null}
          </EdgePanel>

          <View style={styles.pad}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={live ? 'Save' : 'Approve and go live'} size="lg" loading={busy} onPress={() => void submit()} />
            {place.stage === 'review' ? <Button label="Send back with a note" variant="secondary" onPress={() => setBackOpen(true)} /> : null}
          </View>
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet
        visible={backOpen}
        onClose={() => setBackOpen(false)}
        title="Send back"
        subtitle="Tell the team what to fix or check"
        footer={<Button label="Send back" onPress={() => void sendBack()} />}
      >
        <TextField
          label="Note"
          value={note}
          onChangeText={setNote}
          maxLength={REVIEW_NOTE_MAX}
          multiline
          placeholder="Get the secretary’s written OK, and a photo of the water point."
          error={noteError}
        />
      </BottomSheet>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  panel: { gap: spacing.md },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  by: { ...typography.caption, color: colors.slate, fontWeight: '700' },
  help: { ...typography.caption, color: colors.slate },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
