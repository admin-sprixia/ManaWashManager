import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  Avatar,
  BRAND_MARK,
  BottomSheet,
  Button,
  IconCheck,
  IconPhone,
  IconPlus,
  IconStore,
  IconTag,
  IconUsers,
  ScreenContainer,
  ScreenHeader,
  TextField,
  brandGradients,
  colors,
  radius,
  shadow,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import {
  BRANCH_STATUS_LABEL,
  BRANCH_STATUS_REASON_MAX,
  BRANCH_STATUS_REASON_MIN,
  USER_ROLE_LABEL,
  isValidPhone,
  normalizePhone,
  type BranchStatus,
} from '@mana/domain';
import { api } from '../../api/client';
import { formatDateTime, formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatPercent, useCatalog, type Catalog } from './shared';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessBranch'>;
type Branch = Catalog['branches'][number];
type Owner = Branch['owners'][number];
type Overview = InferResponseType<(typeof api)['business']['overview']['$get'], 200>;
type BranchNumbers = Overview['branches'][number];
type TeamMember = InferResponseType<(typeof api)['business']['branches'][':id']['team']['$get'], 200>['team'][number];
type StatusEvent = InferResponseType<(typeof api)['business']['branches'][':id']['status']['$get'], 200>['history'][number];
type Workspace = 'today' | 'team' | 'prices';

const DEFAULT_BOOK = 'default';
const NO_ZONE = 'none';

const STATUS_VERB: Record<BranchStatus, string> = {
  active: 'Reopened',
  paused: 'Paused',
  closed: 'Closed',
};

const STATUS_CHIP: Record<BranchStatus, { fg: string; bg: string; glow: string }> = {
  active: { fg: '#ECFDF5', bg: 'rgba(13,148,136,0.85)', glow: '#5EEAD4' },
  paused: { fg: '#FFFBEB', bg: 'rgba(217,119,6,0.9)', glow: '#FBBF24' },
  closed: { fg: '#F8FAFC', bg: 'rgba(71,85,105,0.9)', glow: '#94A3B8' },
};

function formatPhone(p: string) {
  return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
}

function animateWorkspace() {
  LayoutAnimation.configureNext({
    duration: 220,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
  });
}

/**
 * One branch for Mana Wash HQ — a command surface for the day, the people who run it,
 * and the prices it sells at.
 */
export function BranchDetailScreen({ navigation, route }: Props) {
  const { branchId } = route.params;
  const { catalog, error, load, run } = useCatalog();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>('today');
  const [bookId, setBookId] = useState(DEFAULT_BOOK);
  const [zoneId, setZoneId] = useState(NO_ZONE);
  const [addingOwner, setAddingOwner] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusSheet, setStatusSheet] = useState<'paused' | 'closed' | null>(null);
  const [history, setHistory] = useState<StatusEvent[] | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);

  const reloadOverview = useCallback(async () => {
    try {
      const res = await api.business.overview.$get();
      if (res.ok) setOverview(await res.json());
    } catch {
      // Offline.
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.business.branches[':id'].status.$get({ param: { id: branchId } });
      if (res.ok) setHistory((await res.json()).history);
    } catch {
      // Offline.
    }
  }, [branchId]);

  const loadTeam = useCallback(async () => {
    try {
      const res = await api.business.branches[':id'].team.$get({ param: { id: branchId } });
      if (res.ok) setTeam((await res.json()).team);
    } catch {
      // Offline.
    }
  }, [branchId]);

  useEffect(() => {
    void reloadOverview();
    void loadHistory();
    void loadTeam();
  }, [reloadOverview, loadHistory, loadTeam]);

  const branch = catalog?.branches.find((b) => b.id === branchId) ?? null;
  const numbers = overview?.branches.find((b) => b.id === branchId);
  const signedInHere = branchId === overview?.currentShopId;

  useEffect(() => {
    if (!branch) return;
    setBookId(branch.priceBookId ?? DEFAULT_BOOK);
    setZoneId(branch.priceZoneId ?? NO_ZONE);
    setFormError(null);
  }, [branch?.id, branch?.priceBookId, branch?.priceZoneId]);

  useEffect(() => {
    void loadHistory();
  }, [branch?.status, loadHistory]);

  const bookOptions = useMemo(() => {
    if (!catalog) return [];
    return [
      { value: DEFAULT_BOOK, label: 'Default book', hint: 'Shared business prices' },
      ...catalog.priceBooks
        .filter((b) => !b.isDefault)
        .map((b) => ({ value: b.id, label: b.name, hint: 'This branch only' })),
    ];
  }, [catalog]);

  const zoneOptions = useMemo(() => {
    if (!catalog) return [];
    return [
      { value: NO_ZONE, label: 'No zone', hint: 'List price' },
      ...catalog.zones
        .filter((z) => z.active || z.id === zoneId)
        .map((z) => ({ value: z.id, label: z.name, hint: formatPercent(z.percentBp) })),
    ];
  }, [catalog, zoneId]);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Branch" onBack={() => navigation.goBack()} />
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

  if (!branch) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Branch" onBack={() => navigation.goBack()} />
        </View>
        <View style={styles.centerPad}>
          <Text style={styles.emptyTitle}>Branch not found</Text>
          <Button label="Back" onPress={() => navigation.goBack()} />
        </View>
      </ScreenContainer>
    );
  }

  const chip = STATUS_CHIP[branch.status];
  const selectedBook = bookOptions.find((b) => b.value === bookId) ?? bookOptions[0]!;
  const selectedZone = zoneOptions.find((z) => z.value === zoneId) ?? zoneOptions[0]!;
  const phone = normalizePhone(ownerPhone);
  const g = brandGradients.hero;

  const onStatus = async (status: BranchStatus, reason?: string) => {
    const message = await run(
      () =>
        api.business.branches[':id'].status.$patch({
          param: { id: branch.id },
          json: reason ? { status, reason } : { status },
        }),
      `${branch.name} is now ${BRANCH_STATUS_LABEL[status].toLowerCase()}`,
    );
    if (!message) {
      void reloadOverview();
      void loadHistory();
    }
    return message;
  };

  const addOwner = async () => {
    if (!ownerName.trim()) return setFormError('Enter the owner’s name.');
    if (!isValidPhone(phone)) return setFormError('Enter a 10-digit mobile number.');
    setBusy(true);
    setFormError(null);
    const message = await run(
      () =>
        api.business.branches[':id'].owners.$post({
          param: { id: branch.id },
          json: { name: ownerName.trim(), phone },
        }),
      `${ownerName.trim()} is now an owner`,
    );
    setBusy(false);
    if (message) return setFormError(message);
    setOwnerName('');
    setOwnerPhone('');
    setAddingOwner(false);
  };

  const removeOwner = (owner: Owner) => {
    showAlert(`Remove ${owner.name} as owner?`, 'They’re signed out of this branch straight away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            const message = await run(
              () =>
                api.business.branches[':id'].owners[':userId'].$delete({
                  param: { id: branch.id, userId: owner.id },
                }),
              `${owner.name} removed`,
            );
            setBusy(false);
            if (message) setFormError(message);
          })();
        },
      },
    ]);
  };

  const resetPin = (person: { id: string; name: string }, done?: () => void) => {
    showAlert(
      `Reset ${person.name}’s PIN?`,
      'They’re signed out everywhere. They confirm by WhatsApp and choose a new PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset PIN',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              const message = await run(
                () =>
                  api.business.branches[':id'].team[':userId']['reset-pin'].$post({
                    param: { id: branch.id, userId: person.id },
                  }),
                `${person.name}’s PIN reset`,
              );
              setBusy(false);
              if (message) setFormError(message);
              else done?.();
            })();
          },
        },
      ],
    );
  };

  const savePrices = async () => {
    setBusy(true);
    setFormError(null);
    const message = await run(
      () =>
        api.business.branches[':id'].$patch({
          param: { id: branch.id },
          json: {
            priceBookId: bookId === DEFAULT_BOOK ? null : bookId,
            priceZoneId: zoneId === NO_ZONE ? null : zoneId,
          },
        }),
      `${branch.name} prices updated`,
    );
    setBusy(false);
    if (message) setFormError(message);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), reloadOverview(), loadHistory(), loadTeam()]);
    setRefreshing(false);
  };

  const switchWorkspace = (next: Workspace) => {
    if (next === workspace) return;
    animateWorkspace();
    setWorkspace(next);
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Branch" onBack={() => navigation.goBack()} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        {/* Brand night stage — identity first; status is a chip, not the whole card */}
        <View style={styles.stageWrap}>
          <LinearGradient
            colors={g.colors as unknown as string[]}
            locations={g.locations as unknown as number[]}
            start={g.start}
            end={g.end}
            style={styles.stage}
          >
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 390 260">
              <Defs>
                <RadialGradient id="glow" cx="78%" cy="18%" r="48%">
                  <Stop offset="0%" stopColor="#5468D4" stopOpacity="0.55" />
                  <Stop offset="100%" stopColor="#5468D4" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle cx="310" cy="36" r="130" fill="url(#glow)" />
              {[
                [28, 40, 1.4, 0.5],
                [70, 88, 1, 0.35],
                [120, 28, 1.2, 0.4],
                [200, 70, 0.9, 0.3],
                [340, 120, 1.3, 0.35],
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

            <View style={styles.stageMeta}>
              <Text style={styles.stageCity}>{branch.city || 'Mana Wash'}</Text>
              <View style={styles.codeTicket}>
                <Text style={styles.codeTicketText}>{branch.code}</Text>
              </View>
            </View>

            <Text style={styles.stageName} numberOfLines={2} adjustsFontSizeToFit>
              {branch.name}
            </Text>

            <View style={styles.statusRow}>
              <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: chip.glow }]} />
                <Text style={[styles.statusChipText, { color: chip.fg }]}>
                  {BRANCH_STATUS_LABEL[branch.status]}
                </Text>
              </View>
              {!branch.upToDate ? (
                <View style={styles.updatingChip}>
                  <Text style={styles.updatingChipText}>Menu updating</Text>
                </View>
              ) : null}
              {signedInHere ? (
                <View style={styles.hereChip}>
                  <Text style={styles.hereChipText}>You’re here</Text>
                </View>
              ) : null}
            </View>

            {branch.status !== 'active' && branch.statusReason ? (
              <Text style={styles.stageReason} numberOfLines={2}>
                {branch.statusReason}
              </Text>
            ) : null}
          </LinearGradient>

          {/* Floating day dock */}
          <View style={[styles.dock, shadow('md')]}>
            {(
              [
                { label: 'Paid today', value: numbers ? formatRupees(numbers.today.takings) : '—' },
                { label: 'Washes', value: numbers ? String(numbers.today.washes) : '—' },
                { label: 'In bay', value: numbers ? String(numbers.openWashes) : '—' },
                { label: 'This month', value: numbers ? formatRupees(numbers.month.takings) : '—' },
              ] as const
            ).map((m, i) => (
              <View key={m.label} style={[styles.dockCell, i > 0 && styles.dockCellBorder]}>
                <Text style={styles.dockLabel}>{m.label}</Text>
                <Text style={styles.dockValue} numberOfLines={1} adjustsFontSizeToFit>
                  {m.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Workspace tabs */}
        <View style={styles.tabs}>
          {(
            [
              { key: 'today' as const, label: 'Today' },
              { key: 'team' as const, label: 'Team' },
              { key: 'prices' as const, label: 'Prices' },
            ] as const
          ).map((t) => {
            const on = workspace === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => switchWorkspace(t.key)}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                <View style={[styles.tabUnderline, on && styles.tabUnderlineOn]} />
              </Pressable>
            );
          })}
        </View>

        {workspace === 'today' ? (
          <TodayPane
            branch={branch}
            busy={busy}
            signedInHere={signedInHere}
            history={history}
            owners={branch.owners}
            teamCount={numbers?.team ?? team?.length ?? 0}
            bookLabel={selectedBook.label}
            zoneLabel={selectedZone.label}
            zoneHint={selectedZone.hint}
            onReopen={() =>
              showAlert(`Reopen ${branch.name}?`, 'The team can sign in and start washes again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reopen', onPress: () => void onStatus('active') },
              ])
            }
            onPause={() => setStatusSheet('paused')}
            onClose={() => setStatusSheet('closed')}
            onTeam={() => switchWorkspace('team')}
            onPrices={() => switchWorkspace('prices')}
          />
        ) : null}

        {workspace === 'team' ? (
          <TeamPane
            owners={branch.owners}
            team={team}
            busy={busy}
            onAddOwner={() => {
              setFormError(null);
              setAddingOwner(true);
            }}
            onRemoveOwner={removeOwner}
            onResetPin={resetPin}
            onReloadTeam={() => void loadTeam()}
          />
        ) : null}

        {workspace === 'prices' ? (
          <PricesPane
            bookId={bookId}
            zoneId={zoneId}
            bookOptions={bookOptions}
            zoneOptions={zoneOptions}
            busy={busy}
            error={formError}
            onBook={setBookId}
            onZone={setZoneId}
            onSave={() => void savePrices()}
          />
        ) : null}

        {formError && workspace !== 'prices' ? <Text style={styles.error}>{formError}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      <StatusReasonSheet
        target={statusSheet}
        branchName={branch.name}
        busy={busy}
        onClose={() => setStatusSheet(null)}
        onConfirm={async (status, reason) => {
          setBusy(true);
          const message = await onStatus(status, reason);
          setBusy(false);
          if (!message) setStatusSheet(null);
          return message;
        }}
      />

      <BottomSheet
        visible={addingOwner}
        onClose={() => setAddingOwner(false)}
        dismissable={!busy}
        title="Add an owner"
        subtitle="They sign in with this number and a WhatsApp code."
        footer={<Button label="Add owner" size="lg" loading={busy} onPress={() => void addOwner()} />}
      >
        <TextField
          label="Name"
          placeholder="Ravi Kumar"
          value={ownerName}
          onChangeText={setOwnerName}
          maxLength={60}
          autoCapitalize="words"
        />
        <TextField
          label="Mobile number"
          placeholder="98765 43210"
          value={ownerPhone}
          onChangeText={setOwnerPhone}
          keyboardType="phone-pad"
          maxLength={14}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
      </BottomSheet>
    </ScreenContainer>
  );
}

function TodayPane({
  branch,
  busy,
  signedInHere,
  history,
  owners,
  teamCount,
  bookLabel,
  zoneLabel,
  zoneHint,
  onReopen,
  onPause,
  onClose,
  onTeam,
  onPrices,
}: {
  branch: Branch;
  busy: boolean;
  signedInHere: boolean;
  history: StatusEvent[] | null;
  owners: Owner[];
  teamCount: number;
  bookLabel: string;
  zoneLabel: string;
  zoneHint: string;
  onReopen: () => void;
  onPause: () => void;
  onClose: () => void;
  onTeam: () => void;
  onPrices: () => void;
}) {
  return (
    <View style={styles.pane}>
      {/* Command row */}
      <View style={styles.command}>
        {branch.status !== 'active' ? (
          <Pressable
            onPress={onReopen}
            disabled={busy}
            style={({ pressed }) => [styles.commandPrimary, busy && styles.btnOff, pressed && styles.pressed]}
          >
            <LinearGradient
              colors={brandGradients.primary.colors as unknown as string[]}
              start={brandGradients.primary.start}
              end={brandGradients.primary.end}
              style={styles.commandPrimaryFill}
            >
              <IconCheck size={16} color={colors.white} />
              <Text style={styles.commandPrimaryText}>Reopen branch</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            onPress={onPause}
            disabled={busy}
            style={({ pressed }) => [styles.commandSecondary, busy && styles.btnOff, pressed && styles.pressed]}
          >
            <Text style={styles.commandSecondaryText}>Pause</Text>
          </Pressable>
        )}
        {branch.status !== 'closed' && !signedInHere ? (
          <Pressable
            onPress={onClose}
            disabled={busy}
            style={({ pressed }) => [styles.commandGhost, busy && styles.btnOff, pressed && styles.pressed]}
          >
            <Text style={styles.commandGhostText}>Close</Text>
          </Pressable>
        ) : null}
      </View>
      {signedInHere && branch.status !== 'closed' ? (
        <Text style={styles.hint}>Switch to another branch before you can close this one.</Text>
      ) : null}

      {/* Snapshot cards */}
      <View style={styles.snapRow}>
        <Pressable onPress={onTeam} style={({ pressed }) => [styles.snapCard, pressed && styles.pressed]}>
          <View style={styles.snapTop}>
            <Text style={styles.snapLabel}>Team</Text>
            <IconUsers size={16} color={colors.indigo} />
          </View>
          <View style={styles.facePile}>
            {owners.slice(0, 3).map((o, i) => (
              <View key={o.id} style={[styles.face, { marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }]}>
                <Avatar name={o.name} id={o.id} size={34} />
              </View>
            ))}
            {owners.length === 0 ? (
              <View style={styles.faceEmpty}>
                <IconPlus size={14} color={colors.indigo} />
              </View>
            ) : null}
          </View>
          <Text style={styles.snapValue}>
            {owners.length} owner{owners.length === 1 ? '' : 's'}
            {teamCount ? ` · ${teamCount} people` : ''}
          </Text>
        </Pressable>

        <Pressable onPress={onPrices} style={({ pressed }) => [styles.snapCard, pressed && styles.pressed]}>
          <View style={styles.snapTop}>
            <Text style={styles.snapLabel}>Selling at</Text>
            <IconTag size={16} color={colors.tealDeep} />
          </View>
          <Text style={styles.snapBook} numberOfLines={1}>
            {bookLabel}
          </Text>
          <Text style={styles.snapValue} numberOfLines={1}>
            {zoneLabel}
            {zoneHint && zoneHint !== 'List price' ? ` · ${zoneHint}` : ''}
          </Text>
        </Pressable>
      </View>

      {history && history.length > 0 ? (
        <View style={styles.story}>
          <Text style={styles.sectionTitle}>Status story</Text>
          {history.slice(0, 4).map((h, i, arr) => (
            <View key={h.createdAt} style={styles.storyRow}>
              <View style={styles.storyRail}>
                <View
                  style={[
                    styles.storyDot,
                    {
                      backgroundColor:
                        h.status === 'active' ? colors.teal : h.status === 'paused' ? colors.amber : colors.slate,
                    },
                  ]}
                />
                {i < arr.length - 1 ? <View style={styles.storyLine} /> : null}
              </View>
              <View style={styles.storyBody}>
                <Text style={styles.storyTitle}>{STATUS_VERB[h.status as BranchStatus] ?? h.status}</Text>
                <Text style={styles.storyMeta}>
                  {formatDateTime(h.createdAt)} · +91 {formatPhone(h.changedByPhone)}
                </Text>
                {h.reason ? <Text style={styles.storyReason}>{h.reason}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TeamPane({
  owners,
  team,
  busy,
  onAddOwner,
  onRemoveOwner,
  onResetPin,
  onReloadTeam,
}: {
  owners: Owner[];
  team: TeamMember[] | null;
  busy: boolean;
  onAddOwner: () => void;
  onRemoveOwner: (owner: Owner) => void;
  onResetPin: (person: { id: string; name: string }, done?: () => void) => void;
  onReloadTeam: () => void;
}) {
  return (
    <View style={styles.pane}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Owners</Text>
        <Pressable onPress={onAddOwner} style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}>
          <IconPlus size={14} color={colors.white} />
          <Text style={styles.addPillText}>Add</Text>
        </Pressable>
      </View>

      {owners.length === 0 ? (
        <Pressable onPress={onAddOwner} style={({ pressed }) => [styles.emptyInvite, pressed && styles.pressed]}>
          <IconStore size={22} color={colors.indigo} />
          <View style={styles.flex}>
            <Text style={styles.emptyInviteTitle}>No owner yet</Text>
            <Text style={styles.emptyInviteBody}>Add someone who can run this branch day to day.</Text>
          </View>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portraitRow}>
          {owners.map((o) => (
            <View key={o.id} style={styles.portrait}>
              <Avatar name={o.name} id={o.id} size={64} />
              <Text style={styles.portraitName} numberOfLines={1}>
                {o.name}
              </Text>
              <Text style={styles.portraitMeta} numberOfLines={1}>
                +91 {formatPhone(o.phone)}
              </Text>
              <View style={styles.portraitActions}>
                <Pressable
                  onPress={() => void Linking.openURL(`tel:+91${o.phone}`)}
                  style={({ pressed }) => [styles.portraitBtn, pressed && styles.pressed]}
                >
                  <IconPhone size={14} color={colors.indigo} />
                </Pressable>
                {o.pinSet ? (
                  <Pressable
                    onPress={() => onResetPin(o)}
                    disabled={busy}
                    style={({ pressed }) => [styles.portraitBtn, busy && styles.btnOff, pressed && styles.pressed]}
                  >
                    <Text style={styles.portraitBtnText}>PIN</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onRemoveOwner(o)}
                  disabled={busy}
                  style={({ pressed }) => [styles.portraitBtnDanger, busy && styles.btnOff, pressed && styles.pressed]}
                >
                  <Text style={styles.portraitBtnDangerText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {team && team.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, styles.sectionGap]}>Managers & staff</Text>
          <Text style={styles.hint}>Reset a PIN here when they also work at another branch.</Text>
          <View style={styles.listCard}>
            {team.map((m, i) => (
              <View key={m.id} style={[styles.listRow, i > 0 && styles.listDivider]}>
                <Avatar name={m.name} id={m.id} size={44} muted={!m.active} />
                <View style={styles.flex}>
                  <Text style={styles.listName}>{m.name}</Text>
                  <Text style={styles.listMeta}>
                    {USER_ROLE_LABEL[m.role]} · +91 {formatPhone(m.phone)}
                    {!m.pinSet ? ' · no PIN' : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void Linking.openURL(`tel:+91${m.phone}`)}
                  style={({ pressed }) => [styles.roundBtn, pressed && styles.pressed]}
                >
                  <IconPhone size={15} color={colors.indigo} />
                </Pressable>
                {m.pinSet ? (
                  <Pressable
                    onPress={() => onResetPin(m, onReloadTeam)}
                    disabled={busy}
                    style={({ pressed }) => [styles.textBtn, busy && styles.btnOff, pressed && styles.pressed]}
                  >
                    <Text style={styles.textBtnIndigo}>Reset PIN</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function PricesPane({
  bookId,
  zoneId,
  bookOptions,
  zoneOptions,
  busy,
  error,
  onBook,
  onZone,
  onSave,
}: {
  bookId: string;
  zoneId: string;
  bookOptions: { value: string; label: string; hint: string }[];
  zoneOptions: { value: string; label: string; hint: string }[];
  busy: boolean;
  error: string | null;
  onBook: (id: string) => void;
  onZone: (id: string) => void;
  onSave: () => void;
}) {
  const book = bookOptions.find((o) => o.value === bookId) ?? bookOptions[0]!;
  const zone = zoneOptions.find((o) => o.value === zoneId) ?? zoneOptions[0]!;

  return (
    <View style={styles.pane}>
      <Text style={styles.sectionTitle}>How this branch prices</Text>
      <Text style={styles.hint}>Book × zone rebuilds the menu for New Wash and the customer app.</Text>

      {/* Equation preview */}
      <View style={styles.equation}>
        <View style={[styles.ticket, styles.ticketBook]}>
          <Text style={styles.ticketEyebrow}>Book</Text>
          <Text style={styles.ticketTitle} numberOfLines={2}>
            {book.label}
          </Text>
          <Text style={styles.ticketHint}>{book.hint}</Text>
        </View>
        <Text style={styles.equationOp}>×</Text>
        <View style={[styles.ticket, styles.ticketZone]}>
          <Text style={styles.ticketEyebrow}>Zone</Text>
          <Text style={styles.ticketTitle} numberOfLines={2}>
            {zone.label}
          </Text>
          <Text style={styles.ticketHint}>{zone.hint}</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, styles.sectionGap]}>Price book</Text>
      <View style={styles.listCard}>
        {bookOptions.map((o, i) => {
          const on = o.value === bookId;
          return (
            <Pressable
              key={o.value}
              onPress={() => onBook(o.value)}
              style={({ pressed }) => [styles.pickRow, i > 0 && styles.listDivider, on && styles.pickRowOn, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={[styles.pickLabel, on && styles.pickLabelOn]}>{o.label}</Text>
                <Text style={styles.pickHint}>{o.hint}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <IconCheck size={12} color={colors.white} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, styles.sectionGap]}>Price zone</Text>
      <View style={styles.listCard}>
        {zoneOptions.map((o, i) => {
          const on = o.value === zoneId;
          return (
            <Pressable
              key={o.value}
              onPress={() => onZone(o.value)}
              style={({ pressed }) => [styles.pickRow, i > 0 && styles.listDivider, on && styles.pickRowOn, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={[styles.pickLabel, on && styles.pickLabelOn]}>{o.label}</Text>
                <Text style={styles.pickHint}>{o.hint}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <IconCheck size={12} color={colors.white} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={onSave} disabled={busy} style={({ pressed }) => [pressed && styles.pressed]}>
        <LinearGradient
          colors={brandGradients.primary.colors as unknown as string[]}
          start={brandGradients.primary.start}
          end={brandGradients.primary.end}
          style={styles.saveBtn}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>Save prices</Text>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function StatusReasonSheet({
  target,
  branchName,
  busy,
  onClose,
  onConfirm,
}: {
  target: 'paused' | 'closed' | null;
  branchName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (status: BranchStatus, reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setReason('');
    setError(null);
  }, [target]);

  const confirm = () => {
    if (!target) return;
    const why = reason.trim();
    if (why.length < BRANCH_STATUS_REASON_MIN) return setError('Say why, so the branch team knows.');
    showAlert(
      target === 'paused' ? `Pause ${branchName}?` : `Close ${branchName}?`,
      target === 'paused'
        ? 'No new washes can start. Open washes today can still be finished and paid.'
        : 'Everyone is signed out and can’t sign in. You can reopen later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: target === 'paused' ? 'Pause' : 'Close',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const message = await onConfirm(target, why);
              if (message) setError(message);
            })();
          },
        },
      ],
    );
  };

  return (
    <BottomSheet
      visible={target != null}
      onClose={onClose}
      dismissable={!busy}
      title={target === 'paused' ? 'Pause branch' : 'Close branch'}
      subtitle="The branch team sees this reason."
      footer={
        <Button
          label={target === 'paused' ? 'Pause branch' : 'Close branch'}
          variant="danger"
          size="lg"
          loading={busy}
          onPress={confirm}
        />
      }
    >
      <TextField
        label={target === 'paused' ? 'Why pause it?' : 'Why close it?'}
        placeholder={target === 'paused' ? 'Water supply repair, back Monday' : 'Lease ended'}
        value={reason}
        onChangeText={setReason}
        maxLength={BRANCH_STATUS_REASON_MAX}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  loading: { marginTop: spacing.xl },
  pressed: { opacity: 0.78 },
  btnOff: { opacity: 0.45 },
  flex: { flex: 1, minWidth: 0 },
  bottomPad: { height: spacing.xl },
  error: { ...typography.label, color: colors.danger, textAlign: 'center', marginHorizontal: spacing.md },
  emptyTitle: { ...typography.heading, fontSize: 18, color: colors.ink },
  hint: {
    ...typography.caption,
    fontSize: 13,
    color: colors.slateDeep,
    letterSpacing: 0,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
  },

  stageWrap: { marginHorizontal: spacing.md, marginBottom: 36 },
  stage: {
    borderRadius: 28,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md + 4,
    paddingBottom: 72,
    overflow: 'hidden',
    minHeight: 210,
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  stageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stageCity: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.72)' },
  codeTicket: {
    paddingHorizontal: 11,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  codeTicketText: {
    ...typography.label,
    fontSize: 12.5,
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  stageName: {
    ...typography.display,
    fontSize: 34,
    color: colors.white,
    letterSpacing: -1,
    marginTop: spacing.sm,
    lineHeight: 38,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, flexWrap: 'wrap' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusChipText: { ...typography.label, fontSize: 13, fontWeight: '800' },
  updatingChip: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
  },
  updatingChipText: { ...typography.caption, color: 'rgba(255,255,255,0.9)', fontWeight: '700', letterSpacing: 0 },
  hereChip: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(94,234,212,0.22)',
    justifyContent: 'center',
  },
  hereChipText: { ...typography.caption, color: '#CCFBF1', fontWeight: '700', letterSpacing: 0 },
  stageReason: {
    ...typography.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
    marginTop: spacing.sm,
    lineHeight: 20,
  },

  dock: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: -28,
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 22,
    paddingVertical: 18,
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dockCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  dockCellBorder: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  dockLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0.2 },
  dockValue: { ...typography.bodyStrong, fontSize: 16, color: colors.ink, fontWeight: '800' },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 6 },
  tabText: { ...typography.label, fontSize: 14.5, color: colors.slateDeep, fontWeight: '600', paddingBottom: 10 },
  tabTextOn: { color: colors.indigo, fontWeight: '800' },
  tabUnderline: { height: 3, width: '42%', borderRadius: 2, backgroundColor: 'transparent' },
  tabUnderlineOn: { backgroundColor: colors.indigo },

  pane: { gap: spacing.md, paddingTop: spacing.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.ink,
    letterSpacing: -0.2,
    paddingHorizontal: spacing.md,
  },
  sectionGap: { marginTop: spacing.sm },

  command: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.md },
  commandPrimary: { flex: 1 },
  commandPrimaryFill: {
    height: 52,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  commandPrimaryText: { ...typography.bodyStrong, color: colors.white, fontSize: 15.5 },
  commandSecondary: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  commandSecondaryText: { ...typography.bodyStrong, color: colors.amberDeep, fontSize: 15.5 },
  commandGhost: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerPale,
  },
  commandGhostText: { ...typography.bodyStrong, color: colors.danger, fontSize: 15 },

  snapRow: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.md },
  snapCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.md,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 132,
  },
  snapTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  snapLabel: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0.3, fontWeight: '700' },
  snapBook: { ...typography.heading, fontSize: 18, color: colors.ink, letterSpacing: -0.3 },
  snapValue: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  facePile: { flexDirection: 'row', alignItems: 'center', height: 34 },
  face: { borderRadius: 18, borderWidth: 2, borderColor: colors.white },
  faceEmpty: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },

  story: { gap: 2, paddingHorizontal: spacing.md },
  storyRow: { flexDirection: 'row', gap: spacing.sm },
  storyRail: { width: 14, alignItems: 'center' },
  storyDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  storyLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  storyBody: { flex: 1, paddingBottom: spacing.md, gap: 2 },
  storyTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  storyMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  storyReason: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },

  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.indigo,
  },
  addPillText: { ...typography.label, color: colors.white, fontWeight: '800', fontSize: 13 },
  emptyInvite: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.indigoPale,
  },
  emptyInviteTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800' },
  emptyInviteBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },

  portraitRow: { paddingHorizontal: spacing.md, gap: 12 },
  portrait: {
    width: 148,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.md,
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  portraitName: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '800', textAlign: 'center' },
  portraitMeta: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0, textAlign: 'center' },
  portraitActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  portraitBtn: {
    height: 30,
    minWidth: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitBtnText: { ...typography.label, fontSize: 11.5, color: colors.indigo, fontWeight: '800' },
  portraitBtnDanger: {
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: colors.dangerPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitBtnDangerText: { ...typography.label, fontSize: 11.5, color: colors.danger, fontWeight: '700' },

  listCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  listDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  listName: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800' },
  listMeta: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  textBtnIndigo: { ...typography.label, color: colors.indigo, fontWeight: '800', fontSize: 12.5 },

  equation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
  },
  ticket: {
    flex: 1,
    borderRadius: 20,
    padding: spacing.md,
    gap: 4,
    minHeight: 110,
  },
  ticketBook: { backgroundColor: colors.indigoPale },
  ticketZone: { backgroundColor: colors.tealPale },
  ticketEyebrow: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.slateDeep,
  },
  ticketTitle: { ...typography.heading, fontSize: 17, color: colors.ink, letterSpacing: -0.3 },
  ticketHint: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  equationOp: { ...typography.heading, fontSize: 22, color: colors.slate },

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
  },
  pickRowOn: { backgroundColor: '#EEF2FF' },
  pickLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700' },
  pickLabelOn: { color: colors.indigo },
  pickHint: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  saveBtn: {
    marginHorizontal: spacing.md,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...typography.bodyStrong, color: colors.white, fontSize: 16 },
});
