import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, colors, radius, spacing, typography } from '@mana/ui';
import { MAX_COMMISSION_PAISE, MAX_SERVICE_PRICE_PAISE, overrideRange } from '@mana/domain';
import { formatRupees, parseRupees } from '../../utils/format';
import { paiseToText } from '../business/shared';
import { Pill, partStyles } from '../business/prices/parts';
import type { SheetCell, SheetPolicy } from './types';

/** The quick choices: HQ's price, or a few % either side of it (only those HQ allows). */
const STEPS = [-10, -5, 5, 10];

/**
 * One service at one size: the shop price every vehicle of the size pays here, and the staff
 * commission. Shows HQ's price, how far the owner may go, and what community and home customers
 * then pay, before saving.
 */
export function SizePriceSheet({
  visible,
  title,
  vehicles,
  cell,
  policy,
  communityOf,
  visitFrom,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  /** The branch's vehicles of this size, e.g. "Hatchback". */
  vehicles: string[];
  cell: SheetCell | null;
  policy: SheetPolicy;
  /** The community price for a shop price, by the rule; null when it isn't sold at communities. */
  communityOf: (shopPrice: number) => number | null;
  /** The smallest visit charge, for "home customers pay ₹… +". */
  visitFrom: number | null;
  onClose: () => void;
  onSave: (change: { price?: number | null; commission?: number | null }) => Promise<string | null>;
}) {
  const [text, setText] = useState('');
  const [commission, setCommission] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hub = cell?.hub ?? null;

  useEffect(() => {
    if (!visible) return;
    setText(paiseToText(hub?.price ?? null));
    setCommission(cell?.commission != null && !cell.commissionMixed ? paiseToText(cell.commission) : '');
    setError(null);
    setBusy(false);
  }, [visible, hub?.price, cell?.commission, cell?.commissionMixed]);

  if (!hub) return null;
  const list = hub.list;
  const range = overrideRange(list, policy);
  const canSet = policy.branchOverrides;
  const typed = parseRupees(text);
  const price = typed == null || Number.isNaN(typed) ? null : typed;
  const steps = STEPS.filter((pct) => (pct < 0 ? -pct <= policy.maxDecreasePct : pct <= policy.maxIncreasePct));
  const stepPrice = (pct: number) => Math.min(range.max, Math.max(range.min, Math.round((list * (100 + pct)) / 100 / 100) * 100));
  const preview = price ?? hub.price;
  const community = communityOf(preview);

  const save = async () => {
    const change: { price?: number | null; commission?: number | null } = {};
    if (canSet) {
      if (price == null) return setError('Enter the price in rupees, like 450.');
      if (price > MAX_SERVICE_PRICE_PAISE) return setError('That price looks too large.');
      if (price < range.min || price > range.max) {
        return setError(`HQ lets this branch charge ${formatRupees(range.min)} to ${formatRupees(range.max)}.`);
      }
      if (price !== hub.price || hub.mixed) change.price = price === list ? null : price;
    }
    const c = parseRupees(commission);
    if (c != null && Number.isNaN(c)) return setError('Enter the commission in rupees, like 20.');
    if (c != null && c > MAX_COMMISSION_PAISE) return setError('That commission looks too large.');
    const nextCommission = c ?? null;
    // Left empty while its vehicles have different commissions: those stay as they are.
    if (cell?.commissionMixed ? nextCommission != null : nextCommission !== (cell?.commission ?? null)) {
      change.commission = nextCommission;
    }
    if (change.price === undefined && change.commission === undefined) return onClose();
    setBusy(true);
    const message = await onSave(change);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      subtitle={vehicles.length ? `Shop price for ${vehicles.join(', ')}` : 'Shop price for this size'}
      footer={
        <View style={styles.footer}>
          <Button label="Save" size="lg" loading={busy} onPress={() => void save()} />
          {canSet && (hub.own || hub.mixed) ? (
            <Button
              label={`Use HQ’s price (${formatRupees(list)})`}
              variant="ghost"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void onSave({ price: null }).then((m) => {
                  setBusy(false);
                  if (m) setError(m);
                });
              }}
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.hq}>
        <Text style={styles.hqLabel}>HQ’s price</Text>
        <Text style={styles.hqValue}>{formatRupees(list)}</Text>
        <Text style={styles.hqRange}>
          {canSet
            ? `You can charge ${formatRupees(range.min)} to ${formatRupees(range.max)} (${policy.maxDecreasePct}% less to ${policy.maxIncreasePct}% more).`
            : 'HQ has fixed this price: branches can’t change it.'}
        </Text>
        {hub.mixed ? <Text style={styles.mixed}>Its vehicles have different prices now. Saving gives them all this one.</Text> : null}
      </View>

      {canSet ? (
        <>
          <View style={partStyles.pillRow}>
            <Pill label={`HQ ${formatRupees(list)}`} on={price === list} onPress={() => setText(paiseToText(list))} />
            {steps.map((pct) => (
              <Pill
                key={pct}
                label={`${pct > 0 ? '+' : '−'}${Math.abs(pct)}% · ${formatRupees(stepPrice(pct))}`}
                on={price === stepPrice(pct)}
                onPress={() => setText(paiseToText(stepPrice(pct)))}
              />
            ))}
          </View>
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
              placeholder={paiseToText(list)}
              placeholderTextColor={colors.slate}
              maxLength={7}
            />
          </View>
        </>
      ) : null}

      <View style={styles.preview}>
        <PreviewRow label="At the shop" value={formatRupees(preview)} />
        {community != null ? <PreviewRow label="At communities" value={formatRupees(community)} hint="by the community rule" /> : null}
        {visitFrom != null ? <PreviewRow label="At homes" value={`${formatRupees(preview + visitFrom)}+`} hint="plus the visit charge" /> : null}
      </View>

      <Text style={styles.label}>Staff commission</Text>
      <View style={styles.inputRow}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.input}
          value={commission}
          onChangeText={(t) => {
            setCommission(t);
            if (error) setError(null);
          }}
          keyboardType="numeric"
          placeholder={cell?.commissionMixed ? 'Different for each vehicle' : 'None'}
          placeholderTextColor={colors.slate}
          maxLength={6}
        />
      </View>
      <Text style={partStyles.note}>For whoever gets the customer to take it, once paid. Leave empty for none.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

function PreviewRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.previewRow}>
      <View style={styles.flex}>
        <Text style={styles.previewLabel}>{label}</Text>
        {hint ? <Text style={styles.previewHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { gap: spacing.xs },
  hq: { padding: spacing.sm + 4, borderRadius: radius.lg, backgroundColor: colors.indigoPale, gap: 2 },
  hqLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0.2 },
  hqValue: { ...typography.heading, fontSize: 22, color: colors.indigo },
  hqRange: { ...typography.body, fontSize: 13, color: colors.slateDeep, lineHeight: 18 },
  mixed: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0, marginTop: 4 },
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
  input: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.waterInk, paddingVertical: spacing.sm + 2 },
  preview: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  previewLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  previewHint: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0 },
  previewValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '800' },
  label: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700', marginTop: spacing.xs },
  error: { ...typography.label, color: colors.danger },
});
