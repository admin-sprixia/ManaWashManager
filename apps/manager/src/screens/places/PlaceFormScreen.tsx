import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatDay, inspectionWarnings } from '@mana/domain';
import {
  Button,
  IconAlert,
  IconCheck,
  Notice,
  ScreenContainer,
  ScreenHeader,
  colors,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { api } from '../../api/client';
import { formatDateTime } from '../../utils/format';
import { plansTab } from './review/PlansTab';
import { missingPhotoKinds } from './visit/VisitReport';
import { ScreenHero } from '../../components/ScreenChrome';
import { SheetNotice } from '../../components/SheetBits';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { StageTrack, StickyActions } from './kit';
import { plural } from './panel/parts';
import { approveTab } from './review/ApproveTab';
import { flatsTab } from './review/FlatsTab';
import { joiningTab } from './review/JoiningTab';
import { PlanPreview } from './review/PlanPreview';
import { ReviewTabBar, ReviewTabPanel } from './review/ReviewTabs';
import { scheduleTab } from './review/ScheduleTab';
import { SendBackSheet } from './review/SendBackSheet';
import { statusTab } from './review/StatusTab';
import { teamTab } from './review/TeamTab';
import type { ReviewContext, ReviewTab } from './review/types';
import { useWashSettings } from './review/useWashSettings';
import { visitTab } from './review/VisitTab';
import {
  placeTitle,
  useApiData,
  type PlaceDetail,
  type PlaceListItem,
  type PlaceMember,
  type StaffMenu,
  type TeamUser,
} from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaceForm'>;

/** The tabs, in order. A new one is a file under `review/` and an entry here; `show` picks review or live. */
const TABS: ReviewTab[] = [
  visitTab,
  scheduleTab,
  teamTab,
  joiningTab,
  flatsTab,
  plansTab,
  statusTab,
  approveTab,
];

/**
 * The owner's side of a community: reviewing a draft and making it live with the final days,
 * time and team (or sending it back), and later changing those for a live community.
 */
export function PlaceFormScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const detail = useApiData<PlaceDetail>(
    () => api.places[':id'].$get({ param: { id: placeId } }),
    'Couldn’t load this community.',
  );
  const team = useApiData<{ users: TeamUser[] }>(
    () => api.places.team.$get(),
    'Couldn’t load the team.',
  );
  const others = useApiData<{ places: PlaceListItem[] }>(
    () => api.places.$get(),
    'Couldn’t load the other communities.',
  );
  const menu = useApiData<StaffMenu>(() => api.places.menu.$get({ query: { placeId } }), 'Couldn’t load the prices.');
  const members = useApiData<{ members: PlaceMember[] }>(
    () => api.places[':id'].members.$get({ param: { id: placeId }, query: { filter: 'live' } }),
    'Couldn’t load the members.',
  );
  const place = detail.data?.place ?? null;
  const settings = useWashSettings(placeId, place);
  const [backOpen, setBackOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const tabsY = useRef(0);
  const title = settings.live ? 'Wash settings' : 'Review community';

  // Leaving with changes asks first. `leaving` is set once a save or send-back has gone through.
  const leaving = useRef(false);
  const guard = useRef({ dirty: false, review: false, saveForLater: settings.saveForLater });
  guard.current = {
    dirty: settings.dirty,
    review: !settings.live,
    saveForLater: settings.saveForLater,
  };
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (leaving.current || !guard.current.dirty) return;
        e.preventDefault();
        const go = () => {
          leaving.current = true;
          navigation.dispatch(e.data.action);
        };
        showAlert(
          'Leave without saving?',
          guard.current.review
            ? 'Your choices and ticks will be lost. Save them on this phone to finish later?'
            : 'Your changes haven’t been saved.',
          [
            { text: 'Keep editing', style: 'cancel' },
            ...(guard.current.review
              ? [
                  {
                    text: 'Save for later',
                    onPress: () => void guard.current.saveForLater().then(go),
                  },
                ]
              : []),
            { text: 'Discard', style: 'destructive' as const, onPress: go },
          ],
        );
      }),
    [navigation],
  );

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
          <ActivityIndicator color={colors.teal} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const ctx: ReviewContext = {
    place,
    placeId,
    settings,
    users: team.data?.users ?? [],
    teamError: team.error,
    others: others.data?.places ?? [],
    units: detail.data?.units ?? [],
    menu: menu.data?.menu ?? null,
    menuError: menu.error,
    members: members.data?.members ?? [],
    run: detail.run,
  };
  const tabs = TABS.filter((t) => t.show(ctx));
  // Until a tab is picked, open on what needs a look (the visit when it has warnings), else the
  // schedule. The Approve tab is the last step, so it never opens first.
  const opening =
    tabs.find(
      (t) => t.key !== 'approve' && (t.state(ctx) === 'attention' || t.state(ctx) === 'needed'),
    ) ??
    tabs.find((t) => t.key === 'schedule') ??
    tabs[0]!;
  const setup = place.setup;
  const warnings = inspectionWarnings(setup.inspection).length;
  const toCheck =
    warnings + (setup.missing.length ? 1 : 0) + (missingPhotoKinds(place.photos).length ? 1 : 0);
  const teamNames = ctx.users
    .filter((u) => settings.teamIds.includes(u.id))
    .map((u) => u.name.split(' ')[0]!);
  const current = tabs.find((t) => t.key === active) ?? opening;
  const next = tabs[tabs.indexOf(current) + 1];

  const open = (key: string) => {
    setActive(key);
    scroll.current?.scrollTo({ y: Math.max(0, tabsY.current - spacing.sm), animated: true });
  };

  const save = async () => {
    if (!settings.days.length) open('schedule');
    else if (settings.capacityError) open('joining');
    else if (!settings.live && !settings.checksDone) open('approve');
    const result = await settings.submit();
    if (!result.ok) return;
    leaving.current = true;
    if (settings.live) navigation.goBack();
    else navigation.replace('PlaceLive', { placeId, invited: result.invited ?? 0 });
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          stickyHeaderIndices={[1]}
        >
          <View>
            <ScreenHero
              tone={!settings.live && toCheck ? 'alert' : 'teal'}
              eyebrow={
                settings.live
                  ? 'Wash settings'
                  : setup.createdBy
                    ? `Sent by ${setup.createdBy.name}${setup.submittedAt ? ` · ${formatDay(setup.submittedAt.slice(0, 10))}` : ''}`
                    : 'New community'
              }
              title={placeTitle(place)}
              meta={
                settings.live
                  ? 'Change the plan in the tabs below. Members see new days in the app.'
                  : place.stage === 'draft'
                    ? 'Not sent for approval yet. You can still approve it if you checked it yourself.'
                    : toCheck
                      ? `${plural(toCheck, 'thing')} to check before approving.`
                      : 'Looks good. Set the plan and approve.'
              }
              chips={
                settings.live
                  ? [
                      { label: 'Days', value: settings.days.length },
                      { label: 'Team', value: settings.teamIds.length },
                      {
                        label: 'Status',
                        value:
                          settings.status === 'active'
                            ? 'On'
                            : settings.status === 'paused'
                              ? 'Paused'
                              : 'Closed',
                      },
                    ]
                  : [
                      { label: 'Photos', value: place.photos.length },
                      { label: 'Warnings', value: warnings },
                      { label: 'Choices', value: setup.slots.length },
                    ]
              }
            />

            {!settings.live ? (
              <View style={styles.trackCard}>
                <StageTrack stage={place.stage === 'review' ? 'review' : 'draft'} />
              </View>
            ) : null}

            {settings.restoredAt ? (
              <View style={styles.saved}>
                <IconCheck size={14} color={colors.indigo} />
                <Text style={styles.savedText}>
                  Saved on this phone · {formatDateTime(settings.restoredAt)}
                </Text>
                <Pressable
                  onPress={() => void settings.clearSaved()}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.savedLink}>Forget it</Text>
                </Pressable>
              </View>
            ) : null}

            <PlanPreview
              settings={settings}
              teamNames={teamNames}
              title={settings.live ? 'Current plan' : 'When it goes live'}
            />
          </View>

          <View onLayout={(e) => (tabsY.current = e.nativeEvent.layout.y)}>
            <ReviewTabBar tabs={tabs} active={current.key} onChange={open} ctx={ctx} />
          </View>

          <ReviewTabPanel
            tab={current}
            ctx={ctx}
            next={next}
            onNext={next ? () => open(next.key) : undefined}
          />
          <View style={styles.bottomPad} />
        </ScrollView>

        <StickyActions
          note={
            settings.error ? (
              <SheetNotice tone="danger" icon={<IconAlert size={15} color={colors.danger} />}>
                {settings.error}
              </SheetNotice>
            ) : undefined
          }
        >
          {!settings.live ? (
            <Pressable
              onPress={() => void settings.saveForLater()}
              disabled={!settings.dirty}
              style={({ pressed }) => [
                styles.later,
                !settings.dirty && styles.laterOff,
                pressed && styles.laterPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.laterText}>
                {settings.dirty ? 'Save for later on this phone' : 'Saved for later · nothing new'}
              </Text>
            </Pressable>
          ) : null}
          {place.stage === 'review' ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label="Send back" variant="secondary" onPress={() => setBackOpen(true)} />
              </View>
              <View style={styles.wide}>
                <Button
                  label="Approve & go live"
                  loading={settings.busy}
                  onPress={() => void save()}
                />
              </View>
            </View>
          ) : (
            <Button
              label={settings.live ? 'Save changes' : 'Approve & go live'}
              size="lg"
              loading={settings.busy}
              onPress={() => void save()}
            />
          )}
        </StickyActions>
      </KeyboardAvoidingView>

      <SendBackSheet
        visible={backOpen}
        placeId={placeId}
        onClose={() => setBackOpen(false)}
        run={detail.run}
        onSent={() => {
          setBackOpen(false);
          leaving.current = true;
          void settings.clearSaved();
          navigation.goBack();
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wide: { flex: 1.5 },
  row: { flexDirection: 'row', gap: spacing.sm },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  trackCard: {
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  bottomPad: { height: spacing.lg },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: colors.indigoPale,
  },
  savedText: {
    ...typography.label,
    fontSize: 13,
    color: colors.indigo,
    fontWeight: '700',
    flex: 1,
  },
  savedLink: {
    ...typography.label,
    fontSize: 13,
    color: colors.indigo,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  later: { alignItems: 'center', paddingVertical: 6 },
  laterOff: { opacity: 0.5 },
  laterPressed: { opacity: 0.7 },
  laterText: { ...typography.label, fontSize: 13.5, fontWeight: '800', color: colors.indigo },
});
