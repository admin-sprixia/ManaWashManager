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
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  canManageMember,
  isValidPhone,
  normalizePhone,
  toUserRole,
  USER_ROLE_LABEL,
  type UserRole,
} from '@mana/domain';
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
  IconUsers,
  IconPhone,
  IconPlus,
  IconShield,
  IconSync,
  IconTrash,
  IconUserPlus,
  IconWhatsApp,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { Band, BandRow, ScreenHero, SectionTitle, TipBand } from '../components/ScreenChrome';
import { SheetHead, SheetLabel, SheetNotice, SheetPill } from '../components/SheetBits';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useShop } from '../offline/ShopProvider';
import { sendInvite, type Invitee } from '../utils/teamInvite';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Team'>;

interface Member {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  hasPin: boolean;
}

const ROLE_OPTIONS: { key: UserRole; label: string; hint: string }[] = [
  { key: 'staff', label: 'Staff', hint: 'Washes, payments & expenses' },
  { key: 'manager', label: 'Manager', hint: 'Plus adding staff & resetting their PINs' },
  { key: 'owner', label: 'Owner', hint: 'Everything — money, prices & reports' },
];

/** The roles this person may give someone: managers add staff, owners add managers, HQ adds owners. */
function assignableRoles(me: UserRole, hq: boolean): UserRole[] {
  return ROLE_OPTIONS.map((r) => r.key).filter((r) => canManageMember(me, r, hq));
}

function RoleIcon({ role, color }: { role: UserRole; color: string }) {
  if (role === 'owner') return <IconShield size={15} color={color} />;
  if (role === 'manager') return <IconUsers size={15} color={color} />;
  return <IconPerson size={15} color={color} />;
}

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function RolePicker({
  value,
  options,
  onChange,
}: {
  value: UserRole;
  options: UserRole[];
  onChange: (r: UserRole) => void;
}) {
  return (
    <View style={styles.roleRow}>
      {ROLE_OPTIONS.filter((r) => options.includes(r.key)).map((r) => {
        const on = value === r.key;
        const tint = on ? colors.white : colors.waterDeep;
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            style={({ pressed }) => [
              styles.roleTile,
              on && styles.roleTileOn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={styles.roleTop}>
              <View style={[styles.roleIcon, on && styles.roleIconOn]}>
                <RoleIcon role={r.key} color={tint} />
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

export function TeamScreen({ navigation }: Props) {
  const { user } = useAuth();
  const myRole = user?.role ?? 'staff';
  const { info: shop } = useShop();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  // Only Mana Wash HQ adds, removes or changes owners; quietly left off when offline.
  const [isHq, setIsHq] = useState(false);
  const roleChoices = assignableRoles(myRole, isHq);

  const load = useCallback(async (): Promise<Member[] | null> => {
    try {
      const res = await api.team.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the team.'));
      const list = (await res.json()) as Member[];
      setMembers(list);
      setError(null);
      return list;
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'You’re offline. The team list needs a connection.'
          : (e as Error).message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      api.services.network
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((network) => {
          if (network) setIsHq(network.isBusinessAdmin);
        })
        .catch(() => undefined);
    }, [load]),
  );

  const active = useMemo(
    () =>
      members
        .filter((m) => m.active)
        .sort((a, b) => Number(b.id === user?.id) - Number(a.id === user?.id)),
    [members, user?.id],
  );
  const inactive = useMemo(() => members.filter((m) => !m.active), [members]);
  const ownerCount = active.filter((m) => m.role === 'owner').length;
  const managerCount = active.filter((m) => m.role === 'manager').length;
  const staffCount = active.length - ownerCount - managerCount;
  const noPin = active.filter((m) => !m.hasPin);

  const renderMember = (m: Member, i: number, list: Member[]) => {
    const isSelf = m.id === user?.id;
    const role = toUserRole(m.role);
    const owner = role === 'owner';
    const status = !m.active
      ? 'Access turned off'
      : m.hasPin
        ? 'Has a PIN'
        : 'Hasn’t chosen a PIN yet';
    return (
      <BandRow
        key={m.id}
        icon={
          <View>
            <Avatar name={m.name} id={m.id} size={42} muted={!m.active} />
            {owner && m.active ? (
              <View style={styles.ownerBadge}>
                <IconShield size={10} color={colors.white} />
              </View>
            ) : null}
          </View>
        }
        iconBg="transparent"
        title={isSelf ? `${m.name} · You` : m.name}
        subtitle={`${USER_ROLE_LABEL[role]} · +91 ${formatPhone(m.phone)}\n${status}`}
        muted={!m.active}
        last={i === list.length - 1}
        onPress={() => setSelected(m)}
        right={
          <View style={styles.rowRight}>
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
          </View>
        }
      />
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
            <ScreenHero
              eyebrow={shop?.name ?? 'Your shop'}
              title={`${active.length} ${active.length === 1 ? 'person' : 'people'} on the team`}
              meta={inactive.length ? `${inactive.length} turned off` : undefined}
              chips={[
                { label: ownerCount === 1 ? 'Owner' : 'Owners', value: ownerCount },
                { label: managerCount === 1 ? 'Manager' : 'Managers', value: managerCount },
                { label: 'Staff', value: staffCount },
              ]}
            >
              {active.length > 0 ? (
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
              ) : null}
            </ScreenHero>

            {noPin.length ? (
              <TipBand tone="amber">
                {noPin.length === 1
                  ? `${noPin[0]!.name} hasn’t signed in yet. Tap them to send the invite again.`
                  : `${noPin.length} people haven’t signed in yet. Tap one to send the invite again.`}
              </TipBand>
            ) : null}

            <SectionTitle meta="Tap someone to manage">{`Active · ${active.length}`}</SectionTitle>
            <Band>{active.map(renderMember)}</Band>

            {inactive.length ? (
              <>
                <SectionTitle meta="Past work stays in reports">{`Turned off · ${inactive.length}`}</SectionTitle>
                <Band>{inactive.map(renderMember)}</Band>
              </>
            ) : null}

            <Text style={styles.footnote}>
              Everyone signs in with their own number and their own PIN, so every wash, payment and
              correction is recorded against the person who did it. Nobody — not even the owner —
              can see or set someone else’s PIN.
            </Text>
          </>
        )}
      </ScrollView>

      <AddMemberSheet
        visible={adding}
        roles={roleChoices}
        onClose={() => setAdding(false)}
        onAdded={async (added) => {
          setAdding(false);
          const first = added.name.split(/\s+/)[0] ?? added.name;
          if (await sendInvite(added, shop?.name ?? null)) {
            showToast(`${added.name} added — press send in WhatsApp`);
          } else {
            showToast(`${added.name} added, but WhatsApp didn’t open. Tap ${first} below to send the invite.`, 'error');
          }
          await load();
        }}
      />

      <MemberSheet
        member={selected}
        isSelf={selected?.id === user?.id}
        myRole={myRole}
        isHq={isHq}
        branchName={shop?.name ?? null}
        onClose={() => setSelected(null)}
        onChanged={async (message) => {
          setSelected(null);
          showToast(message);
          await load();
        }}
      />
    </ScreenContainer>
  );
}

function AddMemberSheet({
  visible,
  roles,
  onClose,
  onAdded,
}: {
  visible: boolean;
  /** What this person may add: managers add staff, owners add managers too, HQ adds owners. */
  roles: UserRole[];
  onClose: () => void;
  /** Saved: the screen closes the sheet and opens WhatsApp with the invite. */
  onAdded: (added: Invitee) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<'name' | 'phone' | null>(null);

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
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t add this person.'));
        return;
      }
      const body = await res.json();
      await onAdded({ name: body.name, phone: digits, role, hasPin: body.hasPin });
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Adding a teammate needs a connection.'
          : 'Couldn’t add this person.',
      );
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
      subtitle="We’ll open WhatsApp with an invite and the steps for them."
      footer={
        <>
          <Button
            label={canSave ? `Add ${firstName} and send invite` : 'Add and send invite'}
            size="lg"
            icon={<IconWhatsApp size={20} variant="mono" color={colors.white} />}
            loading={busy}
            disabled={!canSave}
            onPress={() => void save()}
          />
          <Text style={styles.footHint}>
            {canSave
              ? `Adds ${firstName} as ${USER_ROLE_LABEL[role]}, then WhatsApp opens — just press send`
              : 'Fill in a name and a 10-digit number'}
          </Text>
        </>
      }
    >
      <SheetHead
        icon={trimmed ? <Avatar name={trimmed} size={46} /> : <IconUserPlus size={22} color={colors.indigo} />}
        title={trimmed || 'New teammate'}
        caption={digits ? `+91 ${formatPhone(digits)}` : '+91 ····· ·····'}
        right={<SheetPill label={USER_ROLE_LABEL[role]} />}
      />

      <View style={styles.field}>
        <SheetLabel>Full name</SheetLabel>
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
        <SheetLabel>Mobile number</SheetLabel>
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

      {roles.length > 1 ? (
        <View style={styles.field}>
          <SheetLabel>What can they do?</SheetLabel>
          <RolePicker value={role} options={roles} onChange={setRole} />
        </View>
      ) : null}

      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
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
      style={({ pressed }) => [
        styles.actionRow,
        !last && styles.divider,
        pressed && styles.rowPressed,
      ]}
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
  myRole,
  isHq,
  branchName,
  onClose,
  onChanged,
}: {
  member: Member | null;
  isSelf: boolean;
  myRole: UserRole;
  isHq: boolean;
  branchName: string | null;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [role, setRole] = useState<UserRole>('staff');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (member) {
      setRole(toUserRole(member.role));
      setName(member.name);
      setError(null);
      setBusy(false);
    }
  }, [member]);

  if (!member) return <BottomSheet visible={false} onClose={onClose} title="" />;

  const patch = async (
    body: { name?: string; role?: UserRole; active?: boolean },
    message: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.team[':id'].$patch({ param: { id: member.id }, json: body });
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

  const resetPin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.team[':id']['reset-pin'].$post({ param: { id: member.id } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t reset the PIN.'));
        return;
      }
      await onChanged(`${member.name}’s PIN reset — they’ll get back in with a WhatsApp code`);
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t reset the PIN.');
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = () =>
    showAlert(
      `Reset ${member.name}’s PIN?`,
      'They’re signed out on every phone. To get back in they confirm their number with a WhatsApp code and choose a new PIN. They’ll see that you reset it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset PIN', style: 'destructive', onPress: () => void resetPin() },
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
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: () => void patch({ active: false }, `${member.name} turned off`),
          },
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
      'They’re signed out and can’t come back unless they’re added again. Their past work stays in reports, and their number can be added at another branch.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeMember() },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );

  const memberRole = toUserRole(member.role);
  const canManage = !isSelf && canManageMember(myRole, memberRole, isHq);
  const roleOptions = canManage ? assignableRoles(myRole, isHq) : [];
  const nameChanged = name.trim().length > 0 && name.trim() !== member.name;
  const roleChanged = roleOptions.length > 1 && role !== memberRole;

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
      <SheetHead
        tone={!member.active ? 'danger' : member.hasPin ? 'teal' : 'amber'}
        icon={<Avatar name={member.name} id={member.id} size={46} muted={!member.active} />}
        title={USER_ROLE_LABEL[memberRole]}
        caption={
          !member.active
            ? 'Access turned off'
            : member.hasPin
              ? 'Has a PIN'
              : 'Hasn’t chosen a PIN yet'
        }
        right={
          !isSelf ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:+91${member.phone}`)}
              style={({ pressed }) => [styles.callPill, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Call ${member.name}`}
            >
              <IconPhone size={15} color={colors.white} />
              <Text style={styles.callPillText}>Call</Text>
            </Pressable>
          ) : (
            <SheetPill label="You" />
          )
        }
      />

      {canManage ? (
        <View style={styles.field}>
          <SheetLabel>Name</SheetLabel>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            maxLength={60}
            autoCapitalize="words"
          />
        </View>
      ) : null}
      {roleOptions.length > 1 ? (
        <View style={styles.field}>
          <SheetLabel>Role</SheetLabel>
          <RolePicker value={role} options={roleOptions} onChange={setRole} />
        </View>
      ) : null}

      {canManage && member.active ? (
        <View style={styles.field}>
          <SheetLabel>Sign-in</SheetLabel>
          <View style={styles.actionList}>
            {member.hasPin ? (
              <ActionRow
                icon={<IconLock size={17} color={colors.waterDeep} />}
                tint={colors.waterPale}
                title="Reset PIN"
                subtitle="Forgot it, locked out or lost their phone"
                onPress={confirmReset}
                last
              />
            ) : (
              <ActionRow
                icon={<IconWhatsApp size={17} />}
                tint="#DCFCE7"
                title="Send invite again"
                subtitle="Opens WhatsApp with the app link and their steps"
                onPress={() =>
                  void sendInvite({ name: member.name, phone: member.phone, role: memberRole, hasPin: false }, branchName)
                }
                last
              />
            )}
          </View>
        </View>
      ) : null}

      {canManage ? (
        <View style={styles.field}>
          <SheetLabel>Access</SheetLabel>
          <View style={styles.actionList}>
            <ActionRow
              icon={
                member.active ? (
                  <IconBan size={17} color={colors.danger} />
                ) : (
                  <IconCheck size={17} color={colors.tealDeep} />
                )
              }
              tint={member.active ? '#FEE2E2' : '#CCFBF1'}
              title={member.active ? 'Turn off access' : 'Turn access back on'}
              subtitle={
                member.active ? 'For a break or leave — easy to undo' : 'They can sign in again'
              }
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
      ) : isSelf ? (
        <SheetNotice icon={<IconLock size={14} color={colors.indigo} />}>
          Change your own PIN from More → Change PIN.
        </SheetNotice>
      ) : (
        <SheetNotice icon={<IconLock size={14} color={colors.indigo} />}>
          {memberRole === 'owner'
            ? 'Owners are added, changed and reset by Mana Wash HQ.'
            : 'Only the owner can change or reset a manager.'}
        </SheetNotice>
      )}
      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.sm + 2 },
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
  heroMoreText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },

  choicePressed: { backgroundColor: colors.waterPale },

  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    letterSpacing: 0,
    lineHeight: 18,
  },
  stateBox: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateText: {
    ...typography.body,
    fontSize: 14.5,
    color: colors.slateDeep,
    textAlign: 'center',
    lineHeight: 21,
  },

  iconField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  fieldFocus: { borderColor: colors.indigoBright, backgroundColor: colors.white },
  iconInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    paddingVertical: 0,
  },
  phoneDigits: { letterSpacing: 0.8 },
  fieldHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  fieldHintOk: { color: colors.tealDeep, fontWeight: '700' },
  footHint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slate,
    textAlign: 'center',
    letterSpacing: 0,
  },
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

  field: { gap: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
    gap: 3,
    backgroundColor: colors.white,
  },
  roleTileOn: { borderColor: colors.indigoBright, backgroundColor: colors.indigoPale },
  roleTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm + 4,
    backgroundColor: colors.white,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  actionMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
});
