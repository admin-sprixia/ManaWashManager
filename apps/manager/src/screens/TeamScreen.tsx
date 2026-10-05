import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatShopCode, isValidPhone, normalizePhone, type UserRole } from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  BottomSheet,
  Button,
  showToast,
  showAlert,
  IconAlert,
  IconBan,
  IconCheck,
  IconChevronRight,
  IconLock,
  IconPerson,
  IconPhone,
  IconPlus,
  IconShare,
  IconShield,
  IconSync,
  IconTrash,
  IconUserPlus,
  colors,
  gradients,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { SetPinSheet } from '../components/SetPinSheet';
import { api, apiErrorMessage } from '../api/client';
import { handlePlanError } from '../components/UpgradeSheet';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useShop } from '../offline/ShopProvider';
import { shareShopInvite } from '../utils/shopInvite';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Team'>;

interface Member {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  hasPin: boolean;
  /** Over the plan's seats: can't sign in until the shop upgrades. */
  seatLocked?: boolean;
}

interface JoinRequest {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
}

function askedAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const ROLE_OPTIONS: { key: UserRole; label: string; hint: string }[] = [
  { key: 'staff', label: 'Staff', hint: 'Washes, payments & expenses' },
  { key: 'owner', label: 'Owner', hint: 'Everything — prices, reports & team' },
];

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function RolePicker({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <View style={styles.roleRow}>
      {ROLE_OPTIONS.map((r) => {
        const on = value === r.key;
        const tint = on ? colors.white : colors.waterDeep;
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            style={({ pressed }) => [styles.roleTile, on && styles.roleTileOn, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={styles.roleTop}>
              <View style={[styles.roleIcon, on && styles.roleIconOn]}>
                {r.key === 'owner' ? <IconShield size={15} color={tint} /> : <IconPerson size={15} color={tint} />}
              </View>
              {on ? (
                <View style={styles.roleCheck}>
                  <IconCheck size={11} color={colors.white} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.roleLabel, on && styles.roleLabelOn]}>{r.label}</Text>
            <Text style={styles.roleHint}>{r.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionHead({ title, meta, count }: { title: string; meta?: string; count?: number }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

export function TeamScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { info: shop, refresh: refreshShop } = useShop();
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [pinFor, setPinFor] = useState<Member | null>(null);

  const load = useCallback(async (): Promise<Member[] | null> => {
    try {
      const [res, requestsRes] = await Promise.all([api.team.$get(), api.team.requests.$get()]);
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the team.'));
      const list = (await res.json()) as Member[];
      setMembers(list);
      if (requestsRes.ok) setRequests((await requestsRes.json()) as JoinRequest[]);
      setError(null);
      return list;
    } catch (e) {
      setError(e instanceof NetworkError ? 'You’re offline. The team list needs a connection.' : (e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = async (request: JoinRequest, action: 'approve' | 'reject') => {
    setDeciding(request.id);
    try {
      const res =
        action === 'approve'
          ? await api.team.requests[':id'].approve.$post({ param: { id: request.id } })
          : await api.team.requests[':id'].reject.$post({ param: { id: request.id } });
      if (await handlePlanError(res)) {
        // The upgrade sheet explains it; the request stays waiting.
      } else if (!res.ok) {
        showToast(await apiErrorMessage(res, 'Couldn’t update this request.'), 'error');
      } else {
        showToast(
          action === 'approve'
            ? `${request.name} added — they’ll choose their own PIN on their phone`
            : `${request.name}’s request declined`,
        );
      }
    } catch (e) {
      showToast(e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t update this request.', 'error');
    } finally {
      setDeciding(null);
      await load();
      void refreshShop();
    }
  };

  const confirmReject = (request: JoinRequest) =>
    showAlert(
      `Decline ${request.name}?`,
      'They won’t be able to join. They can ask again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => void decide(request, 'reject') },
      ],
      { icon: <IconBan size={26} color={colors.danger} /> },
    );

  const active = useMemo(
    () =>
      members
        .filter((m) => m.active)
        .sort((a, b) => Number(b.id === user?.id) - Number(a.id === user?.id) || Number(b.role === 'owner') - Number(a.role === 'owner')),
    [members, user?.id],
  );
  const inactive = useMemo(() => members.filter((m) => !m.active), [members]);
  const ownerCount = active.filter((m) => m.role === 'owner').length;
  const staffCount = active.length - ownerCount;
  const noPin = active.filter((m) => !m.hasPin);

  const renderMember = (m: Member, i: number, list: Member[]) => {
    const isSelf = m.id === user?.id;
    const owner = m.role === 'owner';
    return (
      <Pressable
        key={m.id}
        onPress={() => setSelected(m)}
        style={({ pressed }) => [styles.memberRow, i < list.length - 1 && styles.divider, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${m.name}, ${owner ? 'owner' : 'staff'}`}
      >
        <View>
          <Avatar name={m.name} id={m.id} size={46} muted={!m.active} />
          {owner && m.active ? (
            <View style={styles.ownerBadge}>
              <IconShield size={10} color={colors.white} />
            </View>
          ) : null}
        </View>
        <View style={styles.memberCopy}>
          <View style={styles.nameRow}>
            <Text style={[styles.memberName, !m.active && styles.mutedText]} numberOfLines={1}>
              {m.name}
            </Text>
            {isSelf ? (
              <View style={styles.youTag}>
                <Text style={styles.youTagText}>You</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.memberPhone}>
            {owner ? 'Owner' : 'Staff'} · +91 {formatPhone(m.phone)}
          </Text>
          {m.active && m.seatLocked ? (
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: colors.amber }]} />
              <Text style={[styles.statusText, { color: colors.amberDeep }]}>Needs Pro — can’t sign in</Text>
            </View>
          ) : m.active ? (
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: m.hasPin ? colors.teal : colors.amber }]} />
              <Text style={[styles.statusText, { color: m.hasPin ? colors.tealDeep : colors.amberDeep }]}>
                {m.hasPin ? 'Can sign in' : 'No PIN yet — can’t sign in'}
              </Text>
            </View>
          ) : (
            <View style={styles.statusLine}>
              <IconBan size={12} color={colors.slate} />
              <Text style={[styles.statusText, styles.mutedText]}>Access turned off</Text>
            </View>
          )}
        </View>
        {!isSelf && m.active ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:+91${m.phone}`)}
            hitSlop={6}
            style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${m.name}`}
          >
            <IconPhone size={16} color={colors.waterDeep} />
          </Pressable>
        ) : null}
        <IconChevronRight size={18} color={colors.slate} />
      </Pressable>
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Team"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => setAdding(true)}
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add team member"
            >
              <IconPlus size={16} color={colors.white} />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.stateBox}>
            <View style={styles.stateIcon}>
              <IconSync size={26} color={colors.waterDeep} />
            </View>
            <Text style={styles.stateText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <>
            <LinearGradient
              colors={gradients.hero as unknown as string[]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.hero}
            >
              <View pointerEvents="none" style={styles.orbLarge} />
              <View pointerEvents="none" style={styles.orbSmall} />
              <Text style={styles.heroEyebrow}>{shop?.name ?? 'Your shop'}</Text>
              <View style={styles.heroValueRow}>
                <Text style={styles.heroValue}>{active.length}</Text>
                <Text style={styles.heroUnit}>{active.length === 1 ? 'person' : 'people'} on the team</Text>
              </View>
              <View style={styles.heroAvatars}>
                {active.slice(0, 6).map((m, i) => (
                  <View key={m.id} style={[styles.heroAvatar, i > 0 && styles.heroAvatarOverlap]}>
                    <Avatar name={m.name} id={m.id} size={30} />
                  </View>
                ))}
                {active.length > 6 ? (
                  <View style={[styles.heroAvatar, styles.heroAvatarOverlap, styles.heroMore]}>
                    <Text style={styles.heroMoreText}>+{active.length - 6}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.heroSplit}>
                <View style={styles.heroCell}>
                  <Text style={styles.heroCellValue}>{ownerCount}</Text>
                  <Text style={styles.heroCellLabel}>Owner{ownerCount === 1 ? '' : 's'}</Text>
                </View>
                <View style={[styles.heroCell, styles.heroCellDivider]}>
                  <Text style={styles.heroCellValue}>{staffCount}</Text>
                  <Text style={styles.heroCellLabel}>Staff</Text>
                </View>
                <View style={[styles.heroCell, styles.heroCellDivider]}>
                  <Text style={[styles.heroCellValue, requests.length > 0 && styles.heroFlag]}>{requests.length}</Text>
                  <Text style={styles.heroCellLabel}>Waiting to join</Text>
                </View>
              </View>
            </LinearGradient>

            {noPin.length ? (
              <Pressable
                onPress={() => setPinFor(noPin[0]!)}
                style={({ pressed }) => [styles.alertBand, pressed && styles.rowPressed]}
                accessibilityRole="button"
              >
                <View style={styles.alertIcon}>
                  <IconAlert size={17} color={colors.amberDeep} />
                </View>
                <View style={styles.alertCopy}>
                  <Text style={styles.alertTitle}>
                    {noPin.length === 1
                      ? `${noPin[0]!.name} can’t sign in yet`
                      : `${noPin.length} people can’t sign in yet`}
                  </Text>
                  <Text style={styles.alertMeta}>Set a PIN and share it with them privately</Text>
                </View>
                <Text style={styles.alertAction}>Set PIN ›</Text>
              </Pressable>
            ) : null}

            {requests.length ? (
              <View>
                <SectionHead title="Waiting to join" count={requests.length} meta="They used your shop ID" />
                <View style={styles.band}>
                  {requests.map((r, i) => (
                    <View key={r.id} style={[styles.requestRow, i < requests.length - 1 && styles.divider]}>
                      <View style={styles.requestTop}>
                        <Avatar name={r.name} id={r.id} size={46} />
                        <View style={styles.memberCopy}>
                          <Text style={styles.memberName} numberOfLines={1}>
                            {r.name}
                          </Text>
                          <Text style={styles.memberPhone}>+91 {formatPhone(r.phone)}</Text>
                          <Text style={styles.askedText}>Asked {askedAgo(r.createdAt)}</Text>
                        </View>
                        {deciding === r.id ? <ActivityIndicator color={colors.water} /> : null}
                      </View>
                      <View style={styles.requestActions}>
                        <Pressable
                          onPress={() => confirmReject(r)}
                          disabled={deciding === r.id}
                          style={({ pressed }) => [styles.declineBtn, pressed && styles.choicePressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Decline ${r.name}`}
                        >
                          <Text style={styles.declineText}>Decline</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void decide(r, 'approve')}
                          disabled={deciding === r.id}
                          style={({ pressed }) => [styles.approveBtn, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Approve ${r.name}`}
                        >
                          <IconCheck size={14} color={colors.white} />
                          <Text style={styles.approveText}>Approve</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={styles.footnote}>
                  Approve only people who work here. They join as Staff — you can change that later.
                </Text>
              </View>
            ) : null}

            <View>
              <SectionHead title="Active" count={active.length} meta="Tap someone to manage" />
              <View style={styles.band}>{active.map(renderMember)}</View>
            </View>

            {inactive.length ? (
              <View>
                <SectionHead title="Turned off" count={inactive.length} meta="Past work stays in reports" />
                <View style={styles.band}>{inactive.map(renderMember)}</View>
              </View>
            ) : null}

            {shop ? (
              <View>
                <SectionHead title="Invite a teammate" />
                <View style={[styles.band, styles.inviteBand]}>
                  <View style={styles.inviteIcon}>
                    <IconUserPlus size={22} color={colors.tealDeep} />
                  </View>
                  <View style={styles.inviteCopy}>
                    <Text style={styles.inviteLabel}>Your shop ID</Text>
                    <Text style={styles.inviteCode}>{formatShopCode(shop.code)}</Text>
                    <Text style={styles.inviteMeta}>They type it in the app, you approve them here</Text>
                  </View>
                  <Pressable
                    onPress={() => shareShopInvite(shop)}
                    style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Share shop ID"
                  >
                    <IconShare size={16} color={colors.white} />
                    <Text style={styles.shareText}>Share</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Text style={styles.footnote}>
              Everyone signs in with their own number, so every wash, payment and correction is recorded
              against the person who did it.
            </Text>
          </>
        )}
      </ScrollView>

      <AddMemberSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={async (name, id) => {
          setAdding(false);
          showToast(`${name} added — now set their PIN so they can sign in`);
          const members = await load();
          const added = members?.find((m) => m.id === id);
          if (added) setPinFor(added);
        }}
      />

      <MemberSheet
        member={selected}
        isSelf={selected?.id === user?.id}
        onClose={() => setSelected(null)}
        onChanged={async (message) => {
          setSelected(null);
          showToast(message);
          await load();
        }}
        onSetPin={(m) => {
          setSelected(null);
          setPinFor(m);
        }}
      />

      <SetPinSheet
        visible={pinFor != null}
        title={pinFor?.hasPin ? 'Reset PIN' : 'Set PIN'}
        subtitle={pinFor ? `For ${pinFor.name} · share it with them privately` : ''}
        onClose={() => setPinFor(null)}
        onSubmit={async (pin) => {
          if (!pinFor) return null;
          try {
            const res = await api.team[':id'].pin.$put({ param: { id: pinFor.id }, json: { pin } });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t save the PIN.');
            showToast(`PIN saved for ${pinFor.name}`);
            setPinFor(null);
            await load();
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t save the PIN.';
          }
        }}
      />
    </ScreenContainer>
  );
}

function AddMemberSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: (name: string, id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<'name' | 'phone' | null>(null);
  const { info: shop } = useShop();

  React.useEffect(() => {
    if (visible) {
      setName('');
      setPhone('');
      setRole('staff');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const digits = normalizePhone(phone);
  const canSave = name.trim().length > 0 && isValidPhone(digits);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.team.$post({ json: { name: name.trim(), phone: digits, role } });
      if (res.status === 402) {
        onClose();
        await handlePlanError(res);
        return;
      }
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t add this person.'));
        return;
      }
      const created = await res.json();
      await onAdded(name.trim(), 'id' in created ? created.id : '');
    } catch (e) {
      setError(e instanceof NetworkError ? 'Adding a teammate needs a connection.' : 'Couldn’t add this person.');
    } finally {
      setBusy(false);
    }
  };

  const trimmed = name.trim();
  const firstName = trimmed.split(/\s+/)[0] ?? '';
  const phoneValid = isValidPhone(digits);
  const phoneHint = phoneValid
    ? 'Looks good'
    : digits.length > 0
      ? `${10 - Math.min(digits.length, 10)} more digit${10 - digits.length === 1 ? '' : 's'}`
      : 'They’ll use this number to sign in';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Add a teammate"
      subtitle="Takes a minute — you’ll set their PIN next."
      footer={
        <>
          <Button
            label={canSave ? `Add ${firstName} as ${role === 'owner' ? 'Owner' : 'Staff'}` : 'Add to team'}
            size="lg"
            loading={busy}
            disabled={!canSave}
            onPress={() => void save()}
          />
          <Text style={styles.footHint}>
            {canSave ? 'Next: choose a 4-digit PIN for them' : 'Fill in a name and a 10-digit number'}
          </Text>
        </>
      }
    >
      <View style={styles.steps}>
        {['Details', 'Set PIN', 'They sign in'].map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 ? <View style={[styles.stepLine, i === 1 && canSave && styles.stepLineOn]} /> : null}
            <View style={styles.step}>
              <View style={[styles.stepDot, i === 0 && styles.stepDotOn]}>
                {i === 0 && canSave ? (
                  <IconCheck size={11} color={colors.white} />
                ) : (
                  <Text style={[styles.stepNum, i === 0 && styles.stepNumOn]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, i === 0 && styles.stepLabelOn]}>{label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      <LinearGradient
        colors={gradients.hero as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.idCard}
      >
        <View pointerEvents="none" style={styles.idOrb} />
        {trimmed ? (
          <View style={styles.idAvatar}>
            <Avatar name={trimmed} size={52} />
          </View>
        ) : (
          <View style={[styles.idAvatar, styles.idAvatarEmpty]}>
            <IconUserPlus size={24} color={colors.white} />
          </View>
        )}
        <View style={styles.memberCopy}>
          <Text style={styles.idName} numberOfLines={1}>
            {trimmed || 'New teammate'}
          </Text>
          <Text style={styles.idPhone}>{digits ? `+91 ${formatPhone(digits)}` : '+91 ····· ·····'}</Text>
          <View style={styles.idRole}>
            {role === 'owner' ? <IconShield size={11} color={colors.white} /> : <IconPerson size={11} color={colors.white} />}
            <Text style={styles.idRoleText}>{role === 'owner' ? 'Owner' : 'Staff'}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Full name</Text>
        <View style={[styles.iconField, focus === 'name' && styles.fieldFocus]}>
          <IconPerson size={18} color={focus === 'name' ? colors.water : colors.slate} />
          <TextInput
            style={styles.iconInput}
            value={name}
            onChangeText={setName}
            onFocus={() => setFocus('name')}
            onBlur={() => setFocus(null)}
            placeholder="e.g. Ravi Kumar"
            placeholderTextColor={colors.slate}
            autoCapitalize="words"
            autoFocus
            maxLength={60}
            returnKeyType="next"
          />
          {trimmed ? <IconCheck size={16} color={colors.teal} /> : null}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <View style={[styles.iconField, focus === 'phone' && styles.fieldFocus]}>
          <IconPhone size={17} color={focus === 'phone' ? colors.water : colors.slate} />
          <Text style={styles.cc}>+91</Text>
          <View style={styles.ccDivider} />
          <TextInput
            style={[styles.iconInput, styles.phoneDigits]}
            value={formatPhone(digits)}
            onChangeText={(t) => setPhone(normalizePhone(t).slice(0, 10))}
            onFocus={() => setFocus('phone')}
            onBlur={() => setFocus(null)}
            placeholder="98765 43210"
            placeholderTextColor={colors.slate}
            keyboardType="phone-pad"
            maxLength={11}
          />
          {phoneValid ? <IconCheck size={16} color={colors.teal} /> : null}
        </View>
        <Text style={[styles.fieldHint, phoneValid && styles.fieldHintOk]}>{phoneHint}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>What can they do?</Text>
        <RolePicker value={role} onChange={setRole} />
      </View>

      {error ? (
        <View style={styles.errorLine}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.sheetError}>{error}</Text>
        </View>
      ) : null}

      {shop ? (
        <Pressable
          onPress={() => shareShopInvite(shop)}
          style={({ pressed }) => [styles.selfJoin, pressed && styles.rowPressed]}
          accessibilityRole="button"
        >
          <View style={styles.selfJoinIcon}>
            <IconShare size={16} color={colors.tealDeep} />
          </View>
          <View style={styles.memberCopy}>
            <Text style={styles.selfJoinTitle}>Or let them join on their own</Text>
            <Text style={styles.actionMeta}>
              Send shop ID {formatShopCode(shop.code)} — they pick their own PIN
            </Text>
          </View>
          <IconChevronRight size={16} color={colors.slate} />
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

function ActionRow({
  icon,
  tint,
  title,
  subtitle,
  danger,
  onPress,
  last,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  subtitle?: string;
  danger?: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, !last && styles.divider, pressed && styles.rowPressed]}
      accessibilityRole="button"
    >
      <View style={[styles.actionIcon, { backgroundColor: tint }]}>{icon}</View>
      <View style={styles.memberCopy}>
        <Text style={[styles.actionTitle, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.actionMeta}>{subtitle}</Text> : null}
      </View>
      <IconChevronRight size={16} color={colors.slate} />
    </Pressable>
  );
}

function MemberSheet({
  member,
  isSelf,
  onClose,
  onChanged,
  onSetPin,
}: {
  member: Member | null;
  isSelf: boolean;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onSetPin: (m: Member) => void;
}) {
  const [role, setRole] = useState<UserRole>('staff');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (member) {
      setRole(member.role === 'owner' ? 'owner' : 'staff');
      setName(member.name);
      setError(null);
      setBusy(false);
    }
  }, [member]);

  if (!member) return <BottomSheet visible={false} onClose={onClose} title="" />;

  const patch = async (body: { name?: string; role?: UserRole; active?: boolean }, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.team[':id'].$patch({ param: { id: member.id }, json: body });
      if (res.status === 402) {
        onClose();
        await handlePlanError(res);
        return;
      }
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save.'));
        return;
      }
      await onChanged(message);
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };

  const removePin = async () => {
    try {
      const res = await api.team[':id'].pin.$delete({ param: { id: member.id } });
      if (!res.ok) return setError(await apiErrorMessage(res));
      await onChanged(`PIN removed for ${member.name}`);
    } catch {
      setError('This needs a connection.');
    }
  };

  const clearPin = () =>
    showAlert(
      'Remove PIN?',
      `${member.name} won’t be able to sign in until a new PIN is set.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removePin() },
      ],
      { icon: <IconLock size={26} color={colors.danger} /> },
    );

  const toggleActive = () => {
    if (member.active) {
      showAlert(
        `Turn off ${member.name}?`,
        'They’ll be signed out on their next action and can’t sign in again. Their past work stays in reports.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn off', style: 'destructive', onPress: () => void patch({ active: false }, `${member.name} turned off`) },
        ],
        { icon: <IconBan size={26} color={colors.danger} /> },
      );
    } else {
      void patch({ active: true }, `${member.name} can sign in again`);
    }
  };

  const removeMember = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.team[':id'].$delete({ param: { id: member.id } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t remove.'));
        return;
      }
      await onChanged(`${member.name} removed from the team`);
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t remove.');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () =>
    showAlert(
      `Remove ${member.name} from the team?`,
      'They’re signed out and can’t come back unless they ask again. Their past work stays in reports, and their number becomes free to join another shop.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeMember() },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );

  const nameChanged = name.trim().length > 0 && name.trim() !== member.name;
  const roleChanged = role !== (member.role === 'owner' ? 'owner' : 'staff');

  return (
    <BottomSheet
      visible
      onClose={onClose}
      dismissable={!busy}
      title={member.name}
      subtitle={`+91 ${formatPhone(member.phone)}${isSelf ? ' · this is you' : ''}`}
      footer={
        nameChanged || roleChanged ? (
          <Button
            label="Save changes"
            size="lg"
            loading={busy}
            onPress={() =>
              void patch(
                { ...(nameChanged ? { name: name.trim() } : {}), ...(roleChanged ? { role } : {}) },
                'Changes saved',
              )
            }
          />
        ) : undefined
      }
    >
      <View style={styles.profile}>
        <Avatar name={member.name} id={member.id} size={52} muted={!member.active} />
        <View style={styles.memberCopy}>
          <View style={styles.statusLine}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: !member.active ? colors.slate : member.hasPin ? colors.teal : colors.amber },
              ]}
            />
            <Text style={styles.profileStatus}>
              {!member.active ? 'Access turned off' : member.hasPin ? 'Can sign in' : 'No PIN yet — can’t sign in'}
            </Text>
          </View>
          <Text style={styles.memberPhone}>{member.role === 'owner' ? 'Owner' : 'Staff'}</Text>
        </View>
        {!isSelf ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:+91${member.phone}`)}
            style={({ pressed }) => [styles.callPill, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${member.name}`}
          >
            <IconPhone size={15} color={colors.white} />
            <Text style={styles.callPillText}>Call</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Role</Text>
        <RolePicker value={role} onChange={setRole} />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Sign-in</Text>
        <View style={styles.actionList}>
          <ActionRow
            icon={<IconLock size={17} color={colors.waterDeep} />}
            tint={colors.waterPale}
            title={member.hasPin ? 'Reset PIN' : 'Set a PIN'}
            subtitle={member.hasPin ? 'Also unlocks after too many wrong tries' : 'Needed to sign in'}
            onPress={() => onSetPin(member)}
            last={!(member.hasPin && !isSelf)}
          />
          {member.hasPin && !isSelf ? (
            <ActionRow
              icon={<IconLock size={17} color={colors.slateDeep} />}
              tint={colors.surface}
              title="Remove PIN"
              subtitle="Blocks sign-in until a new PIN is set"
              onPress={clearPin}
              last
            />
          ) : null}
        </View>
      </View>

      {!isSelf ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Access</Text>
          <View style={styles.actionList}>
            <ActionRow
              icon={member.active ? <IconBan size={17} color={colors.danger} /> : <IconCheck size={17} color={colors.tealDeep} />}
              tint={member.active ? '#FEE2E2' : '#CCFBF1'}
              title={member.active ? 'Turn off access' : 'Turn access back on'}
              subtitle={member.active ? 'For a break or leave — easy to undo' : 'They can sign in again'}
              danger={member.active}
              onPress={toggleActive}
            />
            <ActionRow
              icon={<IconTrash size={17} color={colors.danger} />}
              tint="#FEE2E2"
              title="Remove from team"
              subtitle="Left the shop — frees their number"
              danger
              onPress={confirmRemove}
              last
            />
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.sheetError}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.75 },
  rowPressed: { backgroundColor: colors.surface },
  loader: { marginTop: spacing.xxl },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    height: 36,
  },
  addBtnText: { ...typography.label, color: colors.white },

  hero: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md + 4, overflow: 'hidden' },
  orbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -80,
    right: -60,
  },
  orbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(94,234,212,0.18)',
    bottom: -40,
    left: -30,
  },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 2 },
  heroValue: { ...typography.display, fontSize: 44, color: colors.white, letterSpacing: -1 },
  heroUnit: { ...typography.bodyStrong, fontSize: 16, color: 'rgba(255,255,255,0.92)' },
  heroAvatars: { flexDirection: 'row', marginTop: spacing.sm },
  heroAvatar: { borderRadius: 17, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  heroAvatarOverlap: { marginLeft: -8 },
  heroMore: {
    width: 34,
    height: 34,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMoreText: { ...typography.caption, fontSize: 11, color: colors.white, fontWeight: '800', letterSpacing: 0 },
  heroSplit: {
    flexDirection: 'row',
    marginTop: spacing.md + 4,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.45)',
  },
  heroCell: { flex: 1, gap: 2 },
  heroCellDivider: {
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.45)',
  },
  heroCellValue: { ...typography.heading, fontSize: 19, color: colors.white },
  heroCellLabel: { ...typography.caption, fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: 0 },
  heroFlag: { color: colors.amberLight },

  alertBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: '#FFFBEB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#FDE68A',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    marginTop: -spacing.sm,
  },
  alertIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCopy: { flex: 1, gap: 1 },
  alertTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.amberDeep, fontWeight: '700' },
  alertMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  alertAction: { ...typography.label, fontSize: 13, color: colors.amberDeep },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  sectionMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  countBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { ...typography.caption, fontSize: 12, fontWeight: '800', color: colors.waterDeep, letterSpacing: 0 },

  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
  },
  ownerBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCopy: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700', flexShrink: 1 },
  mutedText: { color: colors.slate },
  youTag: { paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: colors.waterPale, justifyContent: 'center' },
  youTagText: { ...typography.caption, fontSize: 10.5, fontWeight: '800', color: colors.waterDeep, letterSpacing: 0.2 },
  memberPhone: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { ...typography.caption, fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },

  requestRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm + 4 },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  askedText: { ...typography.caption, fontSize: 12, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },
  requestActions: { flexDirection: 'row', gap: spacing.sm },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choicePressed: { backgroundColor: colors.waterPale },
  declineText: { ...typography.label, fontSize: 14, color: colors.slateDeep },
  approveBtn: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { ...typography.label, fontSize: 14, color: colors.white, fontWeight: '800' },

  inviteBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inviteIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCopy: { flex: 1, gap: 1 },
  inviteLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, fontWeight: '700', letterSpacing: 0.3 },
  inviteCode: { ...typography.heading, fontSize: 22, color: colors.waterInk, letterSpacing: 2 },
  inviteMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.water,
  },
  shareText: { ...typography.label, fontSize: 13, color: colors.white },

  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    letterSpacing: 0,
    lineHeight: 18,
  },
  stateBox: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.sm },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateText: { ...typography.body, fontSize: 14.5, color: colors.slateDeep, textAlign: 'center', lineHeight: 21 },

  steps: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: spacing.xs },
  step: { alignItems: 'center', gap: 4, width: 74 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotOn: { backgroundColor: colors.water, borderColor: colors.water },
  stepNum: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.slate, letterSpacing: 0 },
  stepNumOn: { color: colors.white },
  stepLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, fontWeight: '600', letterSpacing: 0 },
  stepLabelOn: { color: colors.waterDeep, fontWeight: '800' },
  stepLine: { flex: 1, height: 2, borderRadius: 1, backgroundColor: colors.border, marginTop: 10 },
  stepLineOn: { backgroundColor: colors.water },

  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  idOrb: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -70,
    right: -40,
  },
  idAvatar: { borderRadius: 30, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.9)' },
  idAvatarEmpty: {
    width: 57,
    height: 57,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  idName: { ...typography.heading, fontSize: 19, color: colors.white },
  idPhone: { ...typography.bodyStrong, fontSize: 14, color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5 },
  idRole: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  idRoleText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: colors.white, letterSpacing: 0.2 },

  iconField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 54,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  fieldFocus: { borderColor: colors.water, backgroundColor: colors.white },
  iconInput: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.waterInk, paddingVertical: 0 },
  phoneDigits: { letterSpacing: 0.8 },
  fieldHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  fieldHintOk: { color: colors.tealDeep, fontWeight: '700' },
  footHint: { ...typography.caption, fontSize: 12, color: colors.slate, textAlign: 'center', letterSpacing: 0 },
  errorLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selfJoin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  selfJoinIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfJoinTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  profileStatus: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  callPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  callPillText: { ...typography.label, fontSize: 13, color: colors.white },

  field: { gap: 6 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  cc: { ...typography.bodyStrong, color: colors.slateDeep },
  ccDivider: { width: 1, height: 22, backgroundColor: colors.border },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleTile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: 3,
    backgroundColor: colors.white,
  },
  roleTileOn: { borderColor: colors.water, backgroundColor: colors.waterPale },
  roleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  roleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconOn: { backgroundColor: colors.water },
  roleCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleLabel: { ...typography.bodyStrong, color: colors.waterInk },
  roleLabelOn: { color: colors.waterDeep },
  roleHint: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 11 },

  actionList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: spacing.sm + 4 },
  actionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  actionMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  sheetError: { ...typography.label, color: colors.danger, textTransform: 'none', flexShrink: 1 },
});
