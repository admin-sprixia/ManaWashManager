import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { isValidPhone, normalizePhone, type UserRole } from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/EdgeList';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { SetPinSheet } from '../components/SetPinSheet';
import { showToast } from '../components/Toast';
import { IconBan, IconCheck, IconLock, IconPlus, IconUsers } from '../components/Icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
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
  { key: 'staff', label: 'Staff', hint: 'Jobs, payments, expenses' },
  { key: 'owner', label: 'Owner', hint: 'Everything, incl. prices & reports' },
];

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function RolePicker({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <View style={styles.roleRow}>
      {ROLE_OPTIONS.map((r) => {
        const on = value === r.key;
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            style={({ pressed }) => [styles.roleTile, on && styles.roleTileOn, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={styles.roleTop}>
              <Text style={[styles.roleLabel, on && styles.roleLabelOn]}>{r.label}</Text>
              {on ? <IconCheck size={16} color={colors.water} /> : null}
            </View>
            <Text style={styles.roleHint}>{r.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TeamScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [pinFor, setPinFor] = useState<Member | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.team.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the team.'));
      setMembers((await res.json()) as Member[]);
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'You’re offline. The team list needs a connection.' : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = useMemo(() => members.filter((m) => m.active), [members]);
  const inactive = useMemo(() => members.filter((m) => !m.active), [members]);
  const ownerCount = active.filter((m) => m.role === 'owner').length;

  const renderMember = (m: Member) => (
    <EdgeRow
      key={m.id}
      icon={<Avatar name={m.name} id={m.id} size={38} muted={!m.active} />}
      iconBg="transparent"
      title={m.id === user?.id ? `${m.name} (you)` : m.name}
      subtitle={`+91 ${formatPhone(m.phone)} · ${m.hasPin ? 'PIN set' : 'No PIN yet'}`}
      tone={m.active ? 'default' : 'muted'}
      right={<Pill label={m.role === 'owner' ? 'OWNER' : 'STAFF'} tone={m.role === 'owner' ? 'water' : 'slate'} />}
      onPress={() => setSelected(m)}
    />
  );

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
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryIcon}>
                <IconUsers size={20} color="#5B21B6" />
              </View>
              <Text style={styles.summaryText}>
                {active.length} active · {ownerCount} owner{ownerCount === 1 ? '' : 's'}
                {inactive.length ? ` · ${inactive.length} turned off` : ''}
              </Text>
            </View>

            <SectionLabel>Active</SectionLabel>
            <EdgeGroup>{active.map(renderMember)}</EdgeGroup>

            {inactive.length ? (
              <>
                <SectionLabel>Turned off</SectionLabel>
                <EdgeGroup>{inactive.map(renderMember)}</EdgeGroup>
              </>
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
        onAdded={async (name) => {
          setAdding(false);
          showToast(`${name} added — they can sign in with an SMS code`);
          await load();
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
  onAdded: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await onAdded(name.trim());
    } catch (e) {
      setError(e instanceof NetworkError ? 'Adding a teammate needs a connection.' : 'Couldn’t add this person.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Add a teammate"
      subtitle="They’ll sign in with this number."
      footer={<Button label="Add to team" size="lg" loading={busy} disabled={!canSave} onPress={() => void save()} />}
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Ravi Kumar"
          placeholderTextColor={colors.slate}
          autoCapitalize="words"
          autoFocus
          maxLength={60}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <View style={styles.phoneField}>
          <Text style={styles.cc}>+91</Text>
          <TextInput
            style={styles.phoneInput}
            value={formatPhone(digits)}
            onChangeText={(t) => setPhone(normalizePhone(t).slice(0, 10))}
            placeholder="98765 43210"
            placeholderTextColor={colors.slate}
            keyboardType="phone-pad"
            maxLength={11}
          />
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Role</Text>
        <RolePicker value={role} onChange={setRole} />
      </View>
      {error ? <Text style={styles.sheetError}>{error}</Text> : null}
    </BottomSheet>
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

  const clearPin = () =>
    Alert.alert('Remove PIN?', `${member.name} will need an SMS code to sign in until a new PIN is set.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.team[':id'].pin.$delete({ param: { id: member.id } });
            if (!res.ok) return setError(await apiErrorMessage(res));
            await onChanged(`PIN removed for ${member.name}`);
          } catch {
            setError('This needs a connection.');
          }
        },
      },
    ]);

  const toggleActive = () => {
    if (member.active) {
      Alert.alert(
        `Turn off ${member.name}?`,
        'They’ll be signed out on their next action and can’t sign in again. Their past work stays in reports.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn off', style: 'destructive', onPress: () => void patch({ active: false }, `${member.name} turned off`) },
        ],
      );
    } else {
      void patch({ active: true }, `${member.name} can sign in again`);
    }
  };

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
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Role</Text>
        <RolePicker value={role} onChange={setRole} />
      </View>

      <EdgeGroup style={styles.sheetList}>
        <EdgeRow
          icon={<IconLock size={18} color={colors.waterDeep} />}
          title={member.hasPin ? 'Reset PIN' : 'Set a PIN'}
          subtitle={member.hasPin ? 'Also unlocks after too many wrong tries' : 'Lets them skip the SMS code'}
          onPress={() => onSetPin(member)}
        />
        {member.hasPin ? (
          <EdgeRow title="Remove PIN" subtitle="Back to SMS-code sign-in only" onPress={clearPin} tone="muted" />
        ) : null}
        {!isSelf ? (
          <EdgeRow
            icon={member.active ? <IconBan size={18} color={colors.danger} /> : <IconCheck size={18} color={colors.teal} />}
            iconBg={member.active ? '#FEE2E2' : '#CCFBF1'}
            title={member.active ? 'Turn off access' : 'Turn access back on'}
            tone={member.active ? 'danger' : 'default'}
            chevron={false}
            onPress={toggleActive}
          />
        ) : null}
      </EdgeGroup>
      {error ? <Text style={styles.sheetError}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
  pressed: { opacity: 0.8 },
  loader: { marginTop: spacing.xxl },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm,
    ...shadow('sm'),
  },
  addBtnText: { ...typography.label, color: colors.white },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  footnote: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },
  errorBox: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  errorText: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
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
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  cc: { ...typography.bodyStrong, color: colors.slateDeep, marginRight: spacing.sm },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    paddingVertical: spacing.sm + 4,
    letterSpacing: 0.5,
  },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleTile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: 4,
    backgroundColor: colors.white,
  },
  roleTileOn: { borderColor: colors.water, backgroundColor: colors.waterPale },
  roleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roleLabel: { ...typography.bodyStrong, color: colors.waterInk },
  roleLabelOn: { color: colors.waterDeep },
  roleHint: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 11 },
  sheetList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sheetError: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
