import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  BRAND_MARK,
  BottomSheet,
  Button,
  ChoiceChips,
  IconPlus,
  IconStore,
  IconTag,
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
  PRICE_BOOK_NAME_MAX,
  isValidTownCode,
  isValidPhone,
  normalizePhone,
} from '@mana/domain';
import { api, apiErrorMessage } from '../../api/client';
import { formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { failure, formatPercent, useCatalog, type Catalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessBranches'>;
type Branch = Catalog['branches'][number];
type Book = Catalog['priceBooks'][number];
type Overview = InferResponseType<(typeof api)['business']['overview']['$get'], 200>;

const NO_ZONE = 'none';

const HERO_ALERT = ['#F59E0B', '#D97706', '#92400E'] as const;
const HERO_OK = ['#0F766E', '#0B4F4A', '#062B28'] as const;

const STARS = [
  [24, 26, 1.2, 0.5],
  [88, 12, 0.9, 0.4],
  [150, 40, 1.1, 0.3],
  [214, 18, 1.2, 0.45],
  [40, 86, 0.8, 0.3],
  [190, 96, 1, 0.3],
] as const;

function statusTone(status: string): { label: string; fg: string; bg: string } {
  if (status === 'paused') return { label: 'Paused', fg: colors.amberDeep, bg: '#FEF3C7' };
  if (status === 'closed') return { label: 'Closed', fg: colors.slateDeep, bg: '#F1F5F9' };
  return { label: 'Open', fg: colors.tealDeep, bg: '#CCFBF1' };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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

/**
 * Mana Wash HQ's view of every branch: today's numbers, and which price book each uses.
 * Tap a branch to open it — status, owners and prices live on that screen.
 */
export function BranchesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const { overview, reload: reloadOverview } = useOverview();
  const [book, setBook] = useState<Book | 'new' | null>(null);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="All branches" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.pad}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const defaultBook = catalog.priceBooks.find((b) => b.isDefault);
  const bookName = (id: string | null) =>
    (id ? catalog.priceBooks.find((b) => b.id === id)?.name : defaultBook?.name) ?? 'Default';
  const zoneOf = (id: string | null) => (id ? catalog.zones.find((z) => z.id === id) : undefined);
  const numbersOf = (id: string) => overview?.branches.find((b) => b.id === id);

  const live = overview?.branches.filter((b) => b.status !== 'closed') ?? [];
  const paused = catalog.branches.filter((b) => b.status === 'paused').length;
  const closed = catalog.branches.filter((b) => b.status === 'closed').length;
  const updating = catalog.branches.filter((b) => !b.upToDate).length;
  const needsAttention = paused > 0 || updating > 0;

  const total = live.reduce(
    (sum, b) => ({
      washes: sum.washes + b.today.washes,
      takings: sum.takings + b.today.takings,
      month: sum.month + b.month.takings,
      open: sum.open + b.openWashes,
    }),
    { washes: 0, takings: 0, month: 0, open: 0 },
  );

  const g = brandGradients.hero;
  const heroColors = (needsAttention ? HERO_ALERT : HERO_OK) as unknown as string[];
  const heroValue = needsAttention
    ? paused > 0
      ? `${plural(paused, 'branch')} paused`
      : `${plural(updating, 'menu')} updating`
    : `${plural(catalog.branches.length, 'branch')}`;
  const heroMeta = needsAttention
    ? 'Tap a branch to pause, reopen, or fix its prices.'
    : overview
      ? `${formatRupees(total.takings)} paid today · ${total.washes} washes`
      : 'Open a branch when you add a new town or location.';

  const deleteBook = (b: Book) => {
    showAlert(`Delete ${b.name}?`, 'Its prices are deleted too. Branches using it must be moved to another book first.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const message = await run(
              () => api.business['price-books'][':id'].$delete({ param: { id: b.id } }),
              'Price book deleted',
            );
            if (message) showAlert('Couldn’t delete', message);
            else setBook(null);
          })();
        },
      },
    ]);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), reloadOverview()]);
    setRefreshing(false);
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="All branches"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => setOpening(true)}
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open a branch"
            >
              <IconPlus size={16} color={colors.white} />
              <Text style={styles.addBtnText}>Branch</Text>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        <LinearGradient
          colors={heroColors}
          locations={g.locations as unknown as number[]}
          start={g.start}
          end={g.end}
          style={[styles.hero, shadow('md')]}
        >
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            viewBox="0 0 340 200"
            preserveAspectRatio="xMidYMid slice"
          >
            {STARS.map(([x, y, r, o]) => (
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
          <Text style={styles.heroEyebrow}>Mana Wash network</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {heroValue}
          </Text>
          <Text style={styles.heroMeta}>{heroMeta}</Text>
          <View style={styles.heroChips}>
            {[
              { label: 'Paid today', value: overview ? formatRupees(total.takings) : '—' },
              { label: 'Washes', value: overview ? String(total.washes) : '—' },
              { label: 'In progress', value: overview ? String(total.open) : '—' },
              { label: 'This month', value: overview ? formatRupees(total.month) : '—' },
            ].map((c) => (
              <View key={c.label} style={styles.heroChip}>
                <Text style={styles.heroChipLabel}>{c.label}</Text>
                <Text style={styles.heroChipValue} numberOfLines={1} adjustsFontSizeToFit>
                  {c.value}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <Text style={styles.sectionLabel}>
          Branches
          {closed > 0 ? ` · ${closed} closed` : ''}
        </Text>
        <View style={styles.band}>
          {catalog.branches.map((b, i) => {
            const zone = zoneOf(b.priceZoneId);
            const numbers = numbersOf(b.id);
            const tone = statusTone(b.status);
            const meta = [
              numbers ? `${formatRupees(numbers.today.takings)} today · ${numbers.today.washes} washes` : null,
              b.code,
              b.city,
              b.owners.length ? b.owners.map((o) => o.name).join(', ') : 'No owner',
              `${bookName(b.priceBookId)} prices`,
              zone ? `${zone.name} ${formatPercent(zone.percentBp)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={b.id}
                onPress={() => navigation.navigate('BusinessBranch', { branchId: b.id })}
                android_ripple={{ color: colors.waterPale }}
                style={({ pressed }) => [
                  styles.row,
                  i < catalog.branches.length - 1 && styles.rowDivider,
                  pressed && styles.pressedRow,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${b.name}, ${tone.label}`}
              >
                <View
                  style={[
                    styles.rowIcon,
                    {
                      backgroundColor:
                        b.status === 'active' ? '#CCFBF1' : b.status === 'paused' ? '#FEF3C7' : '#F1F5F9',
                    },
                  ]}
                >
                  <IconStore
                    size={18}
                    color={b.status === 'active' ? colors.tealDeep : b.status === 'paused' ? colors.amberDeep : colors.slate}
                  />
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {b.name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: !b.upToDate ? '#FEF3C7' : tone.bg }]}>
                      <Text style={[styles.badgeText, { color: !b.upToDate ? colors.amberDeep : tone.fg }]}>
                        {!b.upToDate ? 'Updating' : tone.label}
                      </Text>
                    </View>
                  </View>
                  {b.status !== 'active' && b.statusReason ? (
                    <Text style={styles.rowWarn} numberOfLines={1}>
                      {b.statusReason}
                    </Text>
                  ) : null}
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    {meta}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Price books</Text>
        <Text style={styles.help}>
          Most businesses need one. Add another when some branches charge different base prices.
        </Text>
        <View style={styles.band}>
          {catalog.priceBooks.map((b, i) => {
            const using = catalog.branches.filter((br) => (br.priceBookId ?? defaultBook?.id) === b.id).length;
            return (
              <Pressable
                key={b.id}
                onPress={() => setBook(b)}
                android_ripple={{ color: colors.waterPale }}
                style={({ pressed }) => [
                  styles.row,
                  i < catalog.priceBooks.length - 1 && styles.rowDivider,
                  pressed && styles.pressedRow,
                ]}
                accessibilityRole="button"
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.indigoPale }]}>
                  <IconTag size={18} color={colors.indigo} />
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {b.name}
                    </Text>
                    {b.isDefault ? (
                      <View style={[styles.badge, { backgroundColor: '#CCFBF1' }]}>
                        <Text style={[styles.badgeText, { color: colors.tealDeep }]}>Default</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowMeta}>
                    {plural(using, 'branch')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setBook('new')}
            android_ripple={{ color: colors.waterPale }}
            style={({ pressed }) => [styles.row, styles.rowDivider, pressed && styles.pressedRow]}
            accessibilityRole="button"
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.indigoPale }]}>
              <IconPlus size={18} color={colors.indigo} />
            </View>
            <Text style={styles.addRowTitle}>Add a price book</Text>
          </Pressable>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      <OpenBranchSheet
        visible={opening}
        onClose={() => setOpening(false)}
        onOpened={(opened, ownerPhone) => {
          setOpening(false);
          void load();
          showAlert(
            `${opened.name} is open`,
            `Branch code ${opened.code}. The owner signs in with ${ownerPhone} and a WhatsApp code, then sets their own PIN.`,
          );
          navigation.navigate('BusinessBranch', { branchId: opened.id });
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
                      json: {
                        ...(name !== book.name ? { name } : {}),
                        ...(makeDefault ? { isDefault: true as const } : {}),
                      },
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

function OpenBranchSheet({
  visible,
  onClose,
  onOpened,
}: {
  visible: boolean;
  onClose: () => void;
  onOpened: (branch: { id: string; code: string; name: string }, ownerPhone: string) => void;
}) {
  const [town, setTown] = useState('');
  const [townCode, setTownCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTown('');
    setTownCode('');
    setOwnerName('');
    setOwnerPhone('');
    setErr(null);
    setBusy(false);
  }, [visible]);

  const phone = normalizePhone(ownerPhone);
  const open = async () => {
    if (town.trim().length < 2) return setErr('Enter the town.');
    if (!isValidTownCode(townCode)) return setErr('Town code is 3 letters, like KVR.');
    if (!ownerName.trim()) return setErr('Enter the owner’s name.');
    if (!isValidPhone(phone)) return setErr('Enter the owner’s 10-digit mobile number.');
    setBusy(true);
    setErr(null);
    try {
      const res = await api.business.branches.$post({
        json: { town: town.trim(), townCode, ownerName: ownerName.trim(), ownerPhone: phone },
      });
      if (!res.ok) {
        setErr(await apiErrorMessage(res, 'Couldn’t open the branch.'));
        return;
      }
      onOpened(await res.json(), phone);
    } catch (e) {
      setErr(failure(e));
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
      <TextField label="Town" placeholder="Kovur" value={town} onChangeText={setTown} maxLength={40} autoCapitalize="words" />
      <TextField
        label="Town code"
        placeholder="KVR"
        value={townCode}
        onChangeText={(t) => setTownCode(t.replace(/[^a-zA-Z]/g, '').toUpperCase())}
        maxLength={3}
        autoCapitalize="characters"
        hint="3 letters. The branch gets the next code in the town: KVR-01, then KVR-02."
      />
      <TextField
        label="Owner’s name"
        placeholder="Ravi Kumar"
        value={ownerName}
        onChangeText={setOwnerName}
        maxLength={60}
        autoCapitalize="words"
      />
      <TextField
        label="Owner’s mobile number"
        placeholder="98765 43210"
        value={ownerPhone}
        onChangeText={setOwnerPhone}
        keyboardType="phone-pad"
        maxLength={14}
        hint="They sign in with this number and a WhatsApp code, then set their own PIN."
      />
      {err ? <Text style={styles.error}>{err}</Text> : null}
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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(book?.name ?? '');
    setCopyFrom(catalog.priceBooks.find((b) => b.isDefault)?.id ?? NO_ZONE);
    setMakeDefault(book?.isDefault ? 'yes' : 'no');
    setErr(null);
    setBusy(false);
  }, [visible, book, catalog.priceBooks]);

  const save = async () => {
    if (!name.trim()) return setErr('Enter a name.');
    setBusy(true);
    setErr(null);
    const message = await onSave({
      name: name.trim(),
      copyFrom: copyFrom === NO_ZONE ? null : copyFrom,
      makeDefault: !book?.isDefault && makeDefault === 'yes',
    });
    setBusy(false);
    if (message) setErr(message);
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
      <TextField
        label="Name"
        placeholder="Premium"
        value={name}
        onChangeText={setName}
        maxLength={PRICE_BOOK_NAME_MAX}
        autoCapitalize="words"
      />
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
      {err ? <Text style={styles.error}>{err}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  pad: { padding: spacing.md, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  pressed: { opacity: 0.75 },
  pressedRow: { backgroundColor: colors.surface },
  bottomPad: { height: spacing.lg },
  error: { ...typography.label, color: colors.danger },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 13.5, lineHeight: 19, paddingHorizontal: spacing.md },
  footer: { gap: spacing.xs },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.indigo,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    height: 36,
  },
  addBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },

  hero: { marginHorizontal: spacing.md, borderRadius: radius.xl, padding: spacing.md + 2, gap: 4, overflow: 'hidden' },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: { ...typography.display, fontSize: 34, color: colors.white, letterSpacing: -0.8 },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)', lineHeight: 19 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    width: '47%',
    flexGrow: 1,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroChipLabel: { ...typography.caption, fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.3 },
  heroChipValue: { ...typography.bodyStrong, fontSize: 16, color: colors.white, fontWeight: '800', marginTop: 2 },

  sectionLabel: {
    ...typography.heading,
    fontSize: 16,
    color: colors.ink,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },

  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 3, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: {
    ...typography.bodyStrong,
    flexShrink: 1,
    fontSize: 15.5,
    color: colors.waterInk,
    fontWeight: '800',
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    height: 22,
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  rowWarn: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '600', letterSpacing: 0 },
  rowMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  addRowTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.indigo, fontWeight: '700' },
});
