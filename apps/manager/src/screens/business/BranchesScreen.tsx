import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { PRICE_BOOK_NAME_MAX } from '@mana/domain';
import { api } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatPercent, useCatalog, type Catalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessBranches'>;
type Branch = Catalog['branches'][number];
type Book = Catalog['priceBooks'][number];

const DEFAULT_BOOK = 'default';
const NO_ZONE = 'none';

/** Which price book and zone each branch uses, and the price books themselves. */
export function BranchesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [book, setBook] = useState<Book | 'new' | null>(null);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Branches and price books" onBack={() => navigation.goBack()} />
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
        <ScreenHeader title="Branches and price books" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionLabel>Branches</SectionLabel>
        <EdgeGroup>
          {catalog.branches.map((b) => {
            const zone = zoneOf(b.priceZoneId);
            return (
              <EdgeRow
                key={b.id}
                icon={<IconStore size={19} color={colors.waterDeep} />}
                title={b.name}
                subtitle={[b.city, `${bookName(b.priceBookId)} prices`, zone ? `${zone.name} ${formatPercent(zone.percentBp)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
                right={b.upToDate ? undefined : <Pill label="UPDATING" tone="amber" />}
                onPress={() => setBranch(b)}
              />
            );
          })}
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

function BranchSheet({
  catalog,
  branch,
  onClose,
  onSave,
}: {
  catalog: Catalog;
  branch: Branch | null;
  onClose: () => void;
  onSave: (values: { priceBookId: string | null; priceZoneId: string | null }) => Promise<string | null>;
}) {
  const [bookId, setBookId] = useState(DEFAULT_BOOK);
  const [zoneId, setZoneId] = useState(NO_ZONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!branch) return;
    setBookId(branch.priceBookId ?? DEFAULT_BOOK);
    setZoneId(branch.priceZoneId ?? NO_ZONE);
    setError(null);
    setBusy(false);
  }, [branch]);

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
      subtitle="Its menu is rebuilt with these prices"
      footer={<Button label="Save" size="lg" loading={busy} onPress={() => void save()} />}
    >
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
  bottomPad: { height: spacing.xxl },
});
