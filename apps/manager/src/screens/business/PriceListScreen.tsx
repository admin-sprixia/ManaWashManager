import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  Notice,
  ScreenContainer,
  ScreenHeader,
  colors,
  radius,
  shadow,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { MAX_SERVICE_PRICE_PAISE } from '@mana/domain';
import { api } from '../../api/client';
import { formatRupees, parseRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatPercent, paiseToText, useCatalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessPrices'>;

const cellKey = (serviceId: string, sizeId: string) => `${serviceId}|${sizeId}`;

/**
 * Base prices: one price per service per vehicle size, per price book. Edits collect here and
 * go out in one save, so every branch's menu is rebuilt once.
 */
export function PriceListScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [bookId, setBookId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  /** Unsaved edits: cell → price in paise, null = not priced. */
  const [draft, setDraft] = useState<Map<string, number | null>>(new Map());
  const [editing, setEditing] = useState<{ serviceId: string; sizeId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog) return;
    if (!bookId || !catalog.priceBooks.some((b) => b.id === bookId)) {
      setBookId(catalog.priceBooks.find((b) => b.isDefault)?.id ?? catalog.priceBooks[0]?.id ?? null);
    }
    if (!classId || !catalog.classes.some((c) => c.id === classId)) {
      setClassId(catalog.classes.find((c) => c.category === 'car')?.id ?? catalog.classes[0]?.id ?? null);
    }
  }, [catalog, bookId, classId]);

  // Leaving with unsaved prices asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (draft.size === 0 || saving) return;
        e.preventDefault();
        showAlert('Discard unsaved prices?', `${draft.size} price${draft.size === 1 ? '' : 's'} haven’t been saved.`, [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, draft, saving],
  );

  const saved = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of catalog?.prices ?? []) if (p.priceBookId === bookId) map.set(cellKey(p.serviceId, p.sizeId), p.price);
    return map;
  }, [catalog, bookId]);

  if (!catalog || !bookId || !classId) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Base prices" onBack={() => navigation.goBack()} />
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

  const cls = catalog.classes.find((c) => c.id === classId)!;
  const services = catalog.services.filter((s) => s.active && s.classIds.includes(classId));
  const book = catalog.priceBooks.find((b) => b.id === bookId)!;
  const valueOf = (serviceId: string, sizeId: string): number | null => {
    const key = cellKey(serviceId, sizeId);
    return draft.has(key) ? draft.get(key)! : (saved.get(key) ?? null);
  };
  const doorstep =
    catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId === classId) ??
    catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null);

  const switchBook = (next: string) => {
    if (next === bookId) return;
    if (draft.size === 0) return setBookId(next);
    showAlert('Discard unsaved prices?', 'Save or discard them before switching price book.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setDraft(new Map());
          setBookId(next);
        },
      },
    ]);
  };

  const setCell = (serviceId: string, sizeId: string, price: number | null) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const key = cellKey(serviceId, sizeId);
      if ((saved.get(key) ?? null) === price) next.delete(key);
      else next.set(key, price);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const entries = [...draft].map(([key, price]) => {
      const [serviceId, sizeId] = key.split('|') as [string, string];
      return { serviceId, sizeId, price };
    });
    const message = await run(
      () => api.business.prices.$put({ json: { priceBookId: bookId, entries } }),
      `${entries.length} price${entries.length === 1 ? '' : 's'} saved · every branch updated`,
    );
    setSaving(false);
    if (message) setSaveError(message);
    else setDraft(new Map());
  };

  const editingService = editing ? catalog.services.find((s) => s.id === editing.serviceId) : null;
  const editingSize = editing ? cls.sizes.find((z) => z.id === editing.sizeId) : null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Base prices" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.pad}>
          {catalog.priceBooks.length > 1 ? (
            <ChoiceChips
              label="Price book"
              options={catalog.priceBooks.map((b) => ({ value: b.id, label: b.isDefault ? `${b.name} (default)` : b.name }))}
              value={bookId}
              onChange={switchBook}
            />
          ) : null}
          <ChoiceChips
            label="Vehicles"
            options={catalog.classes.map((c) => ({ value: c.id, label: c.name }))}
            value={classId}
            onChange={setClassId}
          />
          <View style={styles.legend}>
            {cls.sizes.map((z) => {
              const kinds = catalog.bodyTypes.filter((b) => b.active && b.sizeId === z.id).map((b) => b.name);
              return (
                <Text key={z.id} style={styles.legendLine}>
                  <Text style={styles.legendKey}>{z.key}</Text> {z.name}
                  {kinds.length ? ` — ${kinds.join(', ')}` : ' — no vehicles yet'}
                </Text>
              );
            })}
          </View>
        </View>

        {services.length === 0 ? (
          <View style={styles.pad}>
            <Notice tone="info">{`No services for ${cls.name.toLowerCase()} yet. Add them in Services.`}</Notice>
          </View>
        ) : (
          <View style={styles.grid}>
            <View style={[styles.gridRow, styles.gridHead]}>
              <Text style={[styles.nameCell, styles.headText]}>Service</Text>
              {cls.sizes.map((z) => (
                <Text key={z.id} style={[styles.cell, styles.headText]}>
                  {z.key}
                </Text>
              ))}
            </View>
            {services.map((s, i) => (
              <View key={s.id} style={[styles.gridRow, i < services.length - 1 && styles.divider]}>
                <Text style={styles.nameCell} numberOfLines={2}>
                  {s.name}
                </Text>
                {cls.sizes.map((z) => {
                  const value = valueOf(s.id, z.id);
                  const changed = draft.has(cellKey(s.id, z.id));
                  return (
                    <Pressable
                      key={z.id}
                      onPress={() => setEditing({ serviceId: s.id, sizeId: z.id })}
                      style={({ pressed }) => [styles.cell, styles.cellBox, changed && styles.cellChanged, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.name}, ${z.name}: ${value == null ? 'not priced' : formatRupees(value)}`}
                    >
                      <Text style={[styles.cellText, value == null && styles.cellEmpty]} numberOfLines={1} adjustsFontSizeToFit>
                        {value == null ? '—' : formatRupees(value).replace('₹', '')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        <View style={styles.pad}>
          <Text style={styles.help}>
            Prices are in rupees, in the {book.name} price book. A dash means branches don’t offer that service for that size.
            {doorstep
              ? ` ${catalog.homeWash ? 'Doorstep' : 'Community'} washes add ${formatPercent(doorstep.percentBp)}${doorstep.minExtraPaise ? ` (at least ${formatRupees(doorstep.minExtraPaise)})` : ''} — change it in Pricing rules.`
              : ''}
          </Text>
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        </View>
        <View style={styles.bottomPad} />
      </ScrollView>

      {draft.size > 0 ? (
        <View style={styles.saveBar}>
          <Button label="Discard" variant="ghost" disabled={saving} onPress={() => setDraft(new Map())} />
          <View style={styles.flex}>
            <Button
              label={`Save ${draft.size} price${draft.size === 1 ? '' : 's'}`}
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        </View>
      ) : null}

      <CellSheet
        visible={editing != null}
        title={editingService && editingSize ? `${editingService.name} · ${editingSize.name}` : ''}
        value={editing ? valueOf(editing.serviceId, editing.sizeId) : null}
        onClose={() => setEditing(null)}
        onDone={(price) => {
          if (editing) setCell(editing.serviceId, editing.sizeId, price);
          setEditing(null);
        }}
      />
    </ScreenContainer>
  );
}

function CellSheet({
  visible,
  title,
  value,
  onClose,
  onDone,
}: {
  visible: boolean;
  title: string;
  value: number | null;
  onClose: () => void;
  onDone: (price: number | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setText(paiseToText(value));
    setError(null);
  }, [visible, value]);

  const done = () => {
    const p = parseRupees(text);
    if (p == null) return onDone(null);
    if (Number.isNaN(p)) return setError('Enter the price in rupees, like 450.');
    if (p > MAX_SERVICE_PRICE_PAISE) return setError(`That looks too large (over ${formatRupees(MAX_SERVICE_PRICE_PAISE)}).`);
    onDone(p);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle="Base price for this size"
      footer={
        <View style={styles.footer}>
          <Button label="Done" size="lg" onPress={done} />
          {value != null ? <Button label="Not offered for this size" variant="ghost" onPress={() => onDone(null)} /> : null}
        </View>
      }
    >
      <View style={styles.inputRow}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (error) setError(null);
          }}
          keyboardType="numeric"
          placeholder="Not offered"
          placeholderTextColor={colors.slate}
          autoFocus
          maxLength={7}
          onSubmitEditing={done}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, marginTop: spacing.md },
  legend: { gap: 2 },
  legendLine: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
  legendKey: { fontWeight: '800', color: colors.waterInk },
  grid: {
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  gridHead: { backgroundColor: colors.surface, minHeight: 36 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headText: { ...typography.caption, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0.6, textAlign: 'center' },
  nameCell: { flex: 1, ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk, textAlign: 'left' },
  cell: { width: 62 },
  cellBox: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellChanged: { borderColor: colors.amberLight, backgroundColor: '#FFFBEB' },
  cellText: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  cellEmpty: { color: colors.slate },
  pressed: { opacity: 0.7 },
  bottomPad: { height: 120 },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow('lg'),
  },
  footer: { gap: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  rupee: { ...typography.heading, color: colors.slateDeep, marginRight: spacing.xs },
  input: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.waterInk, paddingVertical: spacing.sm + 4 },
  error: { ...typography.label, color: colors.danger },
});
