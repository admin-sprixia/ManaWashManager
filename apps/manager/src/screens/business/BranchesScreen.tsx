import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgeRow,
  IconPlus,
  IconStore,
  IconTag,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import {
  BRANCH_STATUS_LABEL,
  BRANCH_STATUS_REASON_MAX,
  BRANCH_STATUS_REASON_MIN,
  PRICE_BOOK_NAME_MAX,
  USER_ROLE_LABEL,
  formatShopCode,
  isValidPhone,
  normalizePhone,
  type BranchStatus,
} from '@mana/domain';
import { api, apiErrorMessage } from '../../api/client';
import { formatDateTime, formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { failure, formatPercent, useCatalog, type Catalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessBranches'>;
type Branch = Catalog['branches'][number];
type Book = Catalog['priceBooks'][number];
type Owner = Branch['owners'][number];
type Overview = InferResponseType<(typeof api)['business']['overview']['$get'], 200>;
type BranchNumbers = Overview['branches'][number];
type TeamMember = InferResponseType<(typeof api)['business']['branches'][':id']['team']['$get'], 200>['team'][number];
type StatusEvent = InferResponseType<(typeof api)['business']['branches'][':id']['status']['$get'], 200>['history'][number];

function statusPill(status: string) {
  if (status === 'paused') return <Pill label="PAUSED" tone="amber" />;
  if (status === 'closed') return <Pill label="CLOSED" tone="slate" />;
  return undefined;
}

/** Today's and this month's numbers for every branch; quietly left out when offline. */
function useOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await api.business.overview.$get();
      if (res.ok) setOverview(await res.json());
    } catch {
      // Offline: keep the last numbers.
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return { overview, reload: load };
}

const DEFAULT_BOOK = 'default';
const NO_ZONE = 'none';

/**
 * Mana Wash HQ's view of every branch: today's numbers, open / pause / close, owners, and which
 * price book and zone each uses.
 */
export function BranchesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const { overview, reload: reloadOverview } = useOverview();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [book, setBook] = useState<Book | 'new' | null>(null);
  const [opening, setOpening] = useState(false);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="All branches" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const defaultBook = catalog.priceBooks.find((b) => b.isDefault);
  const bookName = (id: string | null) => (id ? catalog.priceBooks.find((b) => b.id === id)?.name : defaultBook?.name) ?? 'Default';
  const zoneOf = (id: string | null) => (id ? catalog.zones.find((z) => z.id === id) : undefined);
  const numbersOf = (id: string) => overview?.branches.find((b) => b.id === id);
  const live = overview?.branches.filter((b) => b.status !== 'closed') ?? [];
  const total = live.reduce(
    (sum, b) => ({
      washes: sum.washes + b.today.washes,
      takings: sum.takings + b.today.takings,
      month: sum.month + b.month.takings,
      open: sum.open + b.openWashes,
    }),
    { washes: 0, takings: 0, month: 0, open: 0 },
  );

  const deleteBook = (b: Book) => {
    showAlert(`Delete ${b.name}?`, 'Its prices are deleted too. Branches using it must be moved to another book first.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const message = await run(() => api.business['price-books'][':id'].$delete({ param: { id: b.id } }), 'Price book deleted');
            if (message) showAlert('Couldn’t delete', message);
            else setBook(null);
          })();
        },
      },
    ]);
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="All branches" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {overview ? (
          <View style={styles.totals}>
            <Stat label="Paid today" value={formatRupees(total.takings)} />
            <Stat label="Washes today" value={String(total.washes)} />
            <Stat label="In progress" value={String(total.open)} />
            <Stat label="This month" value={formatRupees(total.month)} />
          </View>
        ) : null}
        <SectionLabel>Branches</SectionLabel>
        <EdgeGroup>
          {catalog.branches.map((b) => {
            const zone = zoneOf(b.priceZoneId);
            const numbers = numbersOf(b.id);
            return (
              <EdgeRow
                key={b.id}
                icon={<IconStore size={19} color={b.status === 'active' ? colors.waterDeep : colors.slate} />}
                title={b.name}
                subtitle={[
                  b.status !== 'active' && b.statusReason ? b.statusReason : null,
                  numbers ? `${formatRupees(numbers.today.takings)} · ${numbers.today.washes} today` : null,
                  `ID ${formatShopCode(b.code)}`,
                  b.city,
                  b.owners.length ? b.owners.map((o) => o.name).join(', ') : 'No owner',
                  `${bookName(b.priceBookId)} prices`,
                  zone ? `${zone.name} ${formatPercent(zone.percentBp)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={statusPill(b.status) ?? (b.upToDate ? undefined : <Pill label="UPDATING" tone="amber" />)}
                onPress={() => setBranch(b)}
              />
            );
          })}
          <EdgeRow icon={<IconPlus size={18} color={colors.waterDeep} />} title="Open a branch" onPress={() => setOpening(true)} />
        </EdgeGroup>

        <SectionLabel>Price books</SectionLabel>
        <Text style={[styles.help, styles.pad]}>
          Most businesses need one. Add another when some branches charge different base prices, like a premium location.
        </Text>
        <EdgeGroup>
          {catalog.priceBooks.map((b) => {
            const using = catalog.branches.filter((br) => (br.priceBookId ?? defaultBook?.id) === b.id).length;
            return (
              <EdgeRow
                key={b.id}
                icon={<IconTag size={18} color={colors.waterDeep} />}
                title={b.name}
                subtitle={`${using} branch${using === 1 ? '' : 'es'}`}
                right={b.isDefault ? <Pill label="DEFAULT" tone="teal" /> : undefined}
                onPress={() => setBook(b)}
              />
            );
          })}
          <EdgeRow icon={<IconPlus size={18} color={colors.waterDeep} />} title="Add a price book" onPress={() => setBook('new')} />
        </EdgeGroup>
        <View style={styles.bottomPad} />
      </ScrollView>

      <BranchSheet
        catalog={catalog}
        branch={branch}
        live={catalog.branches.find((b) => b.id === branch?.id) ?? null}
        numbers={branch ? numbersOf(branch.id) : undefined}
        signedInHere={branch?.id === overview?.currentShopId}
        onStatus={async (status, reason) => {
          if (!branch) return null;
          const message = await run(
            () =>
              api.business.branches[':id'].status.$patch({
                param: { id: branch.id },
                json: reason ? { status, reason } : { status },
              }),
            `${branch.name} is now ${BRANCH_STATUS_LABEL[status].toLowerCase()}`,
          );
          if (!message) void reloadOverview();
          return message;
        }}
        onResetPin={(owner) =>
          branch
            ? run(
                () =>
                  api.business.branches[':id'].team[':userId']['reset-pin'].$post({
                    param: { id: branch.id, userId: owner.id },
                  }),
                `${owner.name}’s PIN reset — they get back in with a WhatsApp code`,
              )
            : Promise.resolve(null)
        }
        owners={catalog.branches.find((b) => b.id === branch?.id)?.owners ?? []}
        onAddOwner={(values) =>
          branch
            ? run(() => api.business.branches[':id'].owners.$post({ param: { id: branch.id }, json: values }), `${values.name} is now an owner`)
            : Promise.resolve(null)
        }
        onRemoveOwner={(owner) =>
          branch
            ? run(
                () => api.business.branches[':id'].owners[':userId'].$delete({ param: { id: branch.id, userId: owner.id } }),
                `${owner.name} removed`,
              )
            : Promise.resolve(null)
        }
        onClose={() => setBranch(null)}
        onSave={async (values) => {
          if (!branch) return null;
          const message = await run(
            () => api.business.branches[':id'].$patch({ param: { id: branch.id }, json: values }),
            `${branch.name} updated`,
          );
          if (!message) setBranch(null);
          return message;
        }}
      />
      <OpenBranchSheet
        visible={opening}
        onClose={() => setOpening(false)}
        onOpened={(opened, ownerPhone) => {
          setOpening(false);
          void load();
          showAlert(
            `${opened.name} is open`,
            `Branch ID ${formatShopCode(opened.code)}. The owner signs in with ${ownerPhone} and a WhatsApp code, then sets their own PIN.`,
          );
        }}
      />
      <BookSheet
        catalog={catalog}
        book={book === 'new' ? null : book}
        visible={book != null}
        onClose={() => setBook(null)}
        onDelete={book && book !== 'new' && !book.isDefault ? () => deleteBook(book) : undefined}
        onSave={async ({ name, copyFrom, makeDefault }) => {
          const message =
            book && book !== 'new'
              ? await run(
                  () =>
                    api.business['price-books'][':id'].$patch({
                      param: { id: book.id },
                      json: { ...(name !== book.name ? { name } : {}), ...(makeDefault ? { isDefault: true as const } : {}) },
                    }),
                  'Price book saved',
                )
              : await run(() => api.business['price-books'].$post({ json: { name, copyFrom } }), 'Price book added');
          if (!message) setBook(null);
          return message;
        }}
      />
    </ScreenContainer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const STATUS_VERB: Record<BranchStatus, string> = { active: 'Reopened', paused: 'Paused', closed: 'Closed' };

/**
 * Open, pause or close a branch, with the reason the team sees, and the last changes. Paused: no
 * new washes, today's open ones can still be finished and paid. Closed: nobody there can sign in.
 */
function BranchStatusPanel({
  branch,
  signedInHere,
  onStatus,
}: {
  branch: Branch;
  signedInHere: boolean;
  onStatus: (status: BranchStatus, reason?: string) => Promise<string | null>;
}) {
  const [target, setTarget] = useState<'paused' | 'closed' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StatusEvent[] | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.business.branches[':id'].status.$get({ param: { id: branch.id } });
      if (res.ok) setHistory((await res.json()).history);
    } catch {
      // Offline: no history shown.
    }
  }, [branch.id]);

  useEffect(() => {
    setTarget(null);
    setReason('');
    setError(null);
    setHistory(null);
    void loadHistory();
  }, [branch.id, branch.status, loadHistory]);

  const apply = async (status: BranchStatus, why?: string) => {
    setBusy(true);
    setError(null);
    const message = await onStatus(status, why);
    setBusy(false);
    if (message) setError(message);
    else setTarget(null);
  };

  const confirm = () => {
    if (!target) return;
    const why = reason.trim();
    if (why.length < BRANCH_STATUS_REASON_MIN) return setError('Say why, so the branch team knows.');
    showAlert(
      target === 'paused' ? `Pause ${branch.name}?` : `Close ${branch.name}?`,
      target === 'paused'
        ? 'No new washes can start. Washes already open today can still be finished and paid.'
        : 'Everyone at this branch is signed out and can’t sign in. Its records are kept, and you can reopen it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: target === 'paused' ? 'Pause' : 'Close',
          style: 'destructive',
          onPress: () => void apply(target, why),
        },
      ],
    );
  };

  const reopen = () =>
    showAlert(`Reopen ${branch.name}?`, 'The team can sign in and start washes again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', onPress: () => void apply('active') },
    ]);

  return (
    <>
      <Text style={styles.groupLabel}>Status · {BRANCH_STATUS_LABEL[branch.status]}</Text>
      {branch.status !== 'active' && branch.statusReason ? (
        <Notice tone={branch.status === 'paused' ? 'warning' : 'danger'}>{branch.statusReason}</Notice>
      ) : null}
      {target ? (
        <>
          <TextField
            label={target === 'paused' ? 'Why pause it?' : 'Why close it?'}
            placeholder={target === 'paused' ? 'Water supply repair, back Monday' : 'Lease ended'}
            value={reason}
            onChangeText={setReason}
            maxLength={BRANCH_STATUS_REASON_MAX}
            hint="The branch team sees this."
          />
          <View style={styles.statusActions}>
            <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setTarget(null)} />
            <Button
              label={target === 'paused' ? 'Pause branch' : 'Close branch'}
              variant="danger"
              loading={busy}
              onPress={confirm}
            />
          </View>
        </>
      ) : (
        <View style={styles.statusActions}>
          {branch.status !== 'active' ? (
            <Button label="Reopen" variant="secondary" loading={busy} onPress={reopen} />
          ) : null}
          {branch.status === 'active' ? (
            <Button label="Pause" variant="secondary" disabled={busy} onPress={() => setTarget('paused')} />
          ) : null}
          {branch.status !== 'closed' && !signedInHere ? (
            <Button label="Close" variant="ghost" disabled={busy} onPress={() => setTarget('closed')} />
          ) : null}
        </View>
      )}
      {signedInHere && branch.status !== 'closed' ? (
        <Text style={styles.help}>You’re signed in here. Switch to another branch to close this one.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {history && history.length > 0 ? (
        <View style={styles.history}>
          {history.slice(0, 5).map((h) => (
            <Text key={h.createdAt} style={styles.ownerMeta}>
              {[
                `${STATUS_VERB[h.status as BranchStatus] ?? h.status} ${formatDateTime(h.createdAt)}`,
                h.reason,
                `by +91 ${h.changedByPhone}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

/**
 * The branch's managers and staff. The owner resets their PINs from Team; HQ needs this for anyone
 * who also works at another branch, since their one PIN covers branches that owner doesn't run.
 */
function BranchTeam({
  branchId,
  busy,
  onResetPin,
}: {
  branchId: string;
  busy: boolean;
  onResetPin: (person: TeamMember, done: () => void) => void;
}) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await api.business.branches[':id'].team.$get({ param: { id: branchId } });
      if (res.ok) setTeam((await res.json()).team);
    } catch {
      // Offline: the list is left out.
    }
  }, [branchId]);
  useEffect(() => {
    setTeam(null);
    void load();
  }, [load]);

  if (!team || team.length === 0) return null;
  return (
    <>
      <Text style={[styles.groupLabel, styles.groupGap]}>Managers and staff</Text>
      <Text style={styles.help}>
        The owner resets these from Team. Reset here when the person also works at another branch.
      </Text>
      {team.map((m) => (
        <View key={m.id} style={styles.ownerRow}>
          <View style={styles.ownerText}>
            <Text style={styles.ownerName}>{m.name}</Text>
            <Text style={styles.ownerMeta}>
              {[USER_ROLE_LABEL[m.role], `+91 ${m.phone}`, m.active ? null : 'Turned off', m.pinSet ? null : 'No PIN yet']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {m.pinSet ? (
            <Button label="Reset PIN" variant="ghost" disabled={busy} onPress={() => onResetPin(m, () => void load())} />
          ) : null}
        </View>
      ))}
    </>
  );
}

function BranchSheet({
  catalog,
  branch,
  live,
  numbers,
  signedInHere,
  owners,
  onStatus,
  onAddOwner,
  onRemoveOwner,
  onResetPin,
  onClose,
  onSave,
}: {
  catalog: Catalog;
  branch: Branch | null;
  /** The same branch from the latest catalog, so status changes show straight away. */
  live: Branch | null;
  numbers?: BranchNumbers;
  signedInHere: boolean;
  /** Read from the latest catalog, so adds and removals show straight away. */
  owners: Owner[];
  onStatus: (status: BranchStatus, reason?: string) => Promise<string | null>;
  onAddOwner: (values: { name: string; phone: string }) => Promise<string | null>;
  onRemoveOwner: (owner: Owner) => Promise<string | null>;
  onResetPin: (person: { id: string; name: string }) => Promise<string | null>;
  onClose: () => void;
  onSave: (values: { priceBookId: string | null; priceZoneId: string | null }) => Promise<string | null>;
}) {
  const [bookId, setBookId] = useState(DEFAULT_BOOK);
  const [zoneId, setZoneId] = useState(NO_ZONE);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!branch) return;
    setBookId(branch.priceBookId ?? DEFAULT_BOOK);
    setZoneId(branch.priceZoneId ?? NO_ZONE);
    setOwnerName('');
    setOwnerPhone('');
    setError(null);
    setBusy(false);
  }, [branch]);

  const phone = normalizePhone(ownerPhone);
  const addOwner = async () => {
    if (!ownerName.trim()) return setError('Enter the owner’s name.');
    if (!isValidPhone(phone)) return setError('Enter a 10-digit mobile number.');
    setBusy(true);
    setError(null);
    const message = await onAddOwner({ name: ownerName.trim(), phone });
    setBusy(false);
    if (message) return setError(message);
    setOwnerName('');
    setOwnerPhone('');
  };

  const removeOwner = (owner: Owner) => {
    showAlert(`Remove ${owner.name} as owner?`, 'They’re signed out of this branch straight away. Their past work stays in reports.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            const message = await onRemoveOwner(owner);
            setBusy(false);
            if (message) setError(message);
          })();
        },
      },
    ]);
  };

  const resetPin = (person: { id: string; name: string }, done?: () => void) => {
    showAlert(
      `Reset ${person.name}’s PIN?`,
      'They’re signed out on every phone and every branch. To get back in they confirm their number with a WhatsApp code and choose a new PIN. They’ll see that Mana Wash HQ reset it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset PIN',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              const message = await onResetPin(person);
              setBusy(false);
              if (message) setError(message);
              else done?.();
            })();
          },
        },
      ],
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const message = await onSave({
      priceBookId: bookId === DEFAULT_BOOK ? null : bookId,
      priceZoneId: zoneId === NO_ZONE ? null : zoneId,
    });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={branch != null}
      onClose={onClose}
      dismissable={!busy}
      title={branch?.name ?? ''}
      subtitle={branch ? `Branch ID ${formatShopCode(branch.code)}` : undefined}
      footer={<Button label="Save prices" size="lg" loading={busy} onPress={() => void save()} />}
    >
      {numbers ? (
        <View style={styles.totals}>
          <Stat label="Paid today" value={formatRupees(numbers.today.takings)} />
          <Stat label="Washes" value={String(numbers.today.washes)} />
          <Stat label="In progress" value={String(numbers.openWashes)} />
          <Stat label="This month" value={formatRupees(numbers.month.takings)} />
        </View>
      ) : null}
      {numbers ? (
        <Text style={styles.help}>
          {numbers.team} {numbers.team === 1 ? 'person' : 'people'} on the team · {numbers.month.washes} washes this month
        </Text>
      ) : null}
      {live ? <BranchStatusPanel branch={live} signedInHere={signedInHere} onStatus={onStatus} /> : null}
      <Text style={[styles.groupLabel, styles.groupGap]}>Owners</Text>
      {owners.length === 0 ? <Text style={styles.help}>No owner yet. Add one below.</Text> : null}
      {owners.map((o) => (
        <View key={o.id} style={styles.ownerRow}>
          <View style={styles.ownerText}>
            <Text style={styles.ownerName}>{o.name}</Text>
            <Text style={styles.ownerMeta}>
              {[`+91 ${o.phone}`, o.active ? null : 'Turned off', o.pinSet ? null : 'No PIN yet'].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {o.pinSet ? <Button label="Reset PIN" variant="ghost" disabled={busy} onPress={() => resetPin(o)} /> : null}
          <Button label="Remove" variant="ghost" disabled={busy} onPress={() => removeOwner(o)} />
        </View>
      ))}
      <TextField label="New owner’s name" placeholder="Ravi Kumar" value={ownerName} onChangeText={setOwnerName} maxLength={60} autoCapitalize="words" />
      <TextField
        label="Their mobile number"
        placeholder="98765 43210"
        value={ownerPhone}
        onChangeText={setOwnerPhone}
        keyboardType="phone-pad"
        maxLength={14}
        hint="They sign in with this number and a WhatsApp code."
      />
      <Button label="Add owner" variant="secondary" disabled={busy} onPress={() => void addOwner()} />
      {branch ? <BranchTeam branchId={branch.id} busy={busy} onResetPin={resetPin} /> : null}
      <Text style={[styles.groupLabel, styles.groupGap]}>Prices</Text>
      <Text style={styles.help}>The branch menu is rebuilt with these prices.</Text>
      <ChoiceChips
        label="Price book"
        options={[
          { value: DEFAULT_BOOK, label: 'The default book' },
          ...catalog.priceBooks.filter((b) => !b.isDefault).map((b) => ({ value: b.id, label: b.name })),
        ]}
        value={bookId}
        onChange={setBookId}
      />
      <ChoiceChips
        label="Price zone"
        options={[
          { value: NO_ZONE, label: 'No zone' },
          ...catalog.zones.filter((z) => z.active || z.id === zoneId).map((z) => ({ value: z.id, label: `${z.name} ${formatPercent(z.percentBp)}` })),
        ]}
        value={zoneId}
        onChange={setZoneId}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

function OpenBranchSheet({
  visible,
  onClose,
  onOpened,
}: {
  visible: boolean;
  onClose: () => void;
  onOpened: (branch: { id: string; code: string; name: string }, ownerPhone: string) => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setName('');
    setCity('');
    setOwnerName('');
    setOwnerPhone('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const phone = normalizePhone(ownerPhone);
  const open = async () => {
    if (name.trim().length < 2) return setError('Enter the branch name.');
    if (!ownerName.trim()) return setError('Enter the owner’s name.');
    if (!isValidPhone(phone)) return setError('Enter the owner’s 10-digit mobile number.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.business.branches.$post({
        json: { name: name.trim(), city: city.trim() || undefined, ownerName: ownerName.trim(), ownerPhone: phone },
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t open the branch.'));
        return;
      }
      onOpened(await res.json(), phone);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Open a branch"
      subtitle="It gets the Mana Wash menu and prices straight away."
      footer={<Button label="Open branch" size="lg" loading={busy} onPress={() => void open()} />}
    >
      <TextField label="Branch name" placeholder="Mana Wash Kukatpally" value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
      <TextField label="City" optional placeholder="Hyderabad" value={city} onChangeText={setCity} maxLength={40} autoCapitalize="words" />
      <TextField label="Owner’s name" placeholder="Ravi Kumar" value={ownerName} onChangeText={setOwnerName} maxLength={60} autoCapitalize="words" />
      <TextField
        label="Owner’s mobile number"
        placeholder="98765 43210"
        value={ownerPhone}
        onChangeText={setOwnerPhone}
        keyboardType="phone-pad"
        maxLength={14}
        hint="They sign in with this number and a WhatsApp code, then set their own PIN."
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

function BookSheet({
  catalog,
  book,
  visible,
  onClose,
  onSave,
  onDelete,
}: {
  catalog: Catalog;
  book: Book | null;
  visible: boolean;
  onClose: () => void;
  onSave: (values: { name: string; copyFrom: string | null; makeDefault: boolean }) => Promise<string | null>;
  onDelete?: () => void;
}) {
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState(NO_ZONE);
  const [makeDefault, setMakeDefault] = useState<'yes' | 'no'>('no');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setName(book?.name ?? '');
    setCopyFrom(catalog.priceBooks.find((b) => b.isDefault)?.id ?? NO_ZONE);
    setMakeDefault(book?.isDefault ? 'yes' : 'no');
    setError(null);
    setBusy(false);
  }, [visible, book, catalog.priceBooks]);

  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    setError(null);
    const message = await onSave({
      name: name.trim(),
      copyFrom: copyFrom === NO_ZONE ? null : copyFrom,
      makeDefault: !book?.isDefault && makeDefault === 'yes',
    });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={book ? book.name : 'New price book'}
      footer={
        <View style={styles.footer}>
          <Button label={book ? 'Save' : 'Add price book'} size="lg" loading={busy} onPress={() => void save()} />
          {onDelete ? <Button label="Delete price book" variant="ghost" disabled={busy} onPress={onDelete} /> : null}
        </View>
      }
    >
      <TextField label="Name" placeholder="Premium" value={name} onChangeText={setName} maxLength={PRICE_BOOK_NAME_MAX} autoCapitalize="words" />
      {book ? (
        book.isDefault ? (
          <Text style={styles.help}>Branches without a price book of their own use this one.</Text>
        ) : (
          <ChoiceChips
            label="Make it the default"
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={makeDefault}
            onChange={setMakeDefault}
          />
        )
      ) : (
        <ChoiceChips
          label="Start from"
          options={[
            { value: NO_ZONE, label: 'Empty' },
            ...catalog.priceBooks.map((b) => ({ value: b.id, label: `A copy of ${b.name}` })),
          ]}
          value={copyFrom}
          onChange={setCopyFrom}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  footer: { gap: spacing.xs },
  error: { ...typography.label, color: colors.danger },
  groupLabel: { ...typography.label, color: colors.ink },
  groupGap: { marginTop: spacing.md },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownerText: { flex: 1 },
  ownerName: { ...typography.body, color: colors.ink, fontWeight: '600' },
  ownerMeta: { ...typography.caption, color: colors.slate },
  bottomPad: { height: spacing.xxl },
  totals: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stat: { flex: 1, gap: 2 },
  statValue: { ...typography.heading, fontSize: 17, color: colors.waterInk },
  statLabel: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  history: { gap: 4, marginTop: spacing.xs },
});
