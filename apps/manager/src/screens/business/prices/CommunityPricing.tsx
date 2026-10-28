import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  TextField,
  colors,
  showAlert,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { BP_PER_PERCENT, JOIN_DISCOUNT_MAX_BP, communityPrice } from '@mana/domain';
import { api } from '../../../api/client';
import { formatRupees } from '../../../utils/format';
import { bpToText, textToBp, type Catalog, type useCatalog } from '../shared';
import { Panel, Pill, TONE, partStyles } from './parts';

type Run = ReturnType<typeof useCatalog>['run'];
type Adjustment = Catalog['adjustments'][number];

const pct = (bp: number) => `${Math.abs(bp) / BP_PER_PERCENT}%`;
/** "less 10%", "plus 15%", "with no change". */
const describeShortRule = (rule: Pick<Adjustment, 'percentBp'> | null) =>
  !rule?.percentBp ? 'with no change' : `${rule.percentBp < 0 ? 'less' : 'plus'} ${pct(rule.percentBp)}`;

/** "10% less than the hub", "Same as the hub", "15% more, at least ₹50". */
export function describeCommunityRule(rule: Pick<Adjustment, 'percentBp' | 'fixedPaise' | 'minExtraPaise'> | null | undefined): string {
  if (!rule || (!rule.percentBp && !rule.fixedPaise && !rule.minExtraPaise)) return 'Same as the hub';
  const parts: string[] = [];
  if (rule.percentBp) parts.push(`${pct(rule.percentBp)} ${rule.percentBp < 0 ? 'less' : 'more'}`);
  if (rule.fixedPaise) parts.push(`${formatRupees(Math.abs(rule.fixedPaise))} ${rule.fixedPaise < 0 ? 'less' : 'more'}`);
  if (rule.minExtraPaise) parts.push(`at least ${formatRupees(rule.minExtraPaise)} more`);
  return `${parts.join(', ')} than the hub`;
}

/**
 * Communities: the team goes out to them, so a community pays the hub price plus the community
 * rule (10% by default, ending in 9); never less than the hub. The neighbours discount then takes
 * up to a set % off as more of a community's flats wash with us, still never below the hub price.
 */
export function CommunityPricing({
  catalog,
  run,
  classId,
  example,
}: {
  catalog: Catalog;
  run: Run;
  classId: string;
  /** A wash to show the neighbours discount on, like Basic Wash · S: its hub and community prices. */
  example: { name: string; price: number; hub: number } | null;
}) {
  const cls = catalog.classes.find((c) => c.id === classId);
  const own = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId === classId) ?? null;
  const all = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null) ?? null;
  const rule = own ?? all;
  const maxBp = catalog.away.joinDiscountBp;
  const [editingRule, setEditingRule] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [busyPct, setBusyPct] = useState<number | null>(null);
  const currentBp = rule?.percentBp ?? 0;
  const plain = !rule || (!rule.fixedPaise && !rule.minExtraPaise);

  const saveRule = async (next: { percentBp: number; classOnly: boolean }): Promise<string | null> => {
    const classKey = next.classOnly ? classId : null;
    const exists = catalog.adjustments.some((a) => a.mode === 'doorstep' && a.classId === classKey);
    // "Same as the hub" is no rule, except for one vehicle when all vehicles have one.
    const clear = next.percentBp === 0 && !(next.classOnly && all);
    let message: string | null = null;
    if (clear) {
      if (exists) {
        message = await run(
          () => api.business.adjustments.$delete({ json: { mode: 'doorstep', classId: classKey } }),
          'Rule saved · branches updated',
        );
      }
    } else {
      message = await run(
        () =>
          api.business.adjustments.$put({
            json: { mode: 'doorstep', classId: classKey, percentBp: next.percentBp, fixedPaise: 0, minExtraPaise: 0 },
          }),
        'Rule saved · branches updated',
      );
    }
    // Changing back to "all vehicles" drops this vehicle's own rule.
    if (!message && !next.classOnly && own) {
      const dropped = await run(() => api.business.adjustments.$delete({ json: { mode: 'doorstep', classId } }));
      if (dropped) return dropped;
    }
    return message;
  };

  const quick = async (bp: number) => {
    if (bp === currentBp && plain) return;
    setBusyPct(bp);
    const message = await saveRule({ percentBp: bp, classOnly: own != null });
    setBusyPct(null);
    if (message) showAlert('Couldn’t save the rule', message);
  };

  // The neighbours discount as a community fills up: 10 flats is the easy way to read it.
  const ladder = [0, 2, 5, 8, 10].map((joined) => ({
    label: joined === 0 ? 'No flats yet' : joined === 10 ? 'Every flat' : `${joined} of 10 flats`,
    off: Math.round((maxBp * joined) / 10),
  }));

  return (
    <>
      <Panel
        title={describeCommunityRule(rule)}
        subtitle={`Community price = hub price ${describeShortRule(rule)} · ${own ? `only ${cls?.name.toLowerCase() ?? 'these vehicles'}` : 'all vehicles'}`}
        onEdit={() => setEditingRule(true)}
        editLabel="More"
      >
        <View style={partStyles.pillRow}>
          {QUICK_RULES.map((q) => (
            <Pill
              key={q.bp}
              label={busyPct === q.bp ? 'Saving…' : q.label}
              on={plain && currentBp === q.bp}
              tone="community"
              onPress={() => void quick(q.bp)}
            />
          ))}
        </View>
        <Text style={partStyles.note}>
          Every community price is worked out from the hub price with this rule. Change the % and every price below changes.
        </Text>
      </Panel>

      <Panel
        title="Neighbours discount"
        subtitle={
          maxBp
            ? `Up to ${pct(maxBp)} off when every flat joins: ${pct(maxBp / 10)} for every 10% of flats. Never below the hub price.`
            : 'Off. Turn it on so communities pay less as more neighbours join.'
        }
        onEdit={() => setEditingDiscount(true)}
        editLabel="Edit"
      >
        {maxBp ? (
          <View style={styles.ladder}>
            {ladder.map((l) => {
              const price = example ? communityPrice(example.price, example.hub, l.off) : null;
              const atHub = example != null && price === example.hub && l.off > 0;
              return (
                <View key={l.label} style={styles.ladderRow}>
                  <View style={styles.ladderLabelCol}>
                    <Text style={styles.ladderLabel}>{l.label}</Text>
                    <Text style={styles.ladderOff}>{l.off ? `${pct(l.off)} off` : 'Community price'}</Text>
                  </View>
                  <View style={styles.ladderTrack}>
                    <View style={[styles.ladderBar, { width: `${Math.max(8, (l.off / maxBp) * 100)}%`, opacity: l.off ? 1 : 0.35 }]} />
                  </View>
                  <View style={styles.ladderPriceCol}>
                    <Text style={styles.ladderPrice}>{price != null ? formatRupees(price) : ''}</Text>
                    {atHub ? <Text style={styles.ladderHub}>hub price</Text> : null}
                  </View>
                </View>
              );
            })}
            <Text style={partStyles.note}>
              {example ? `Prices are for ${example.name} (hub ${formatRupees(example.hub)}). ` : ''}A flat counts when it has a plan running or a
              wash booked this month. Every wash and plan there gets the same %, worked out again at each renewal.
            </Text>
          </View>
        ) : null}
      </Panel>

      <RuleSheet
        visible={editingRule}
        className={cls?.name ?? 'These vehicles'}
        rule={rule}
        classOnly={own != null}
        onClose={() => setEditingRule(false)}
        onSave={async (next) => {
          const message = await saveRule(next);
          if (!message) setEditingRule(false);
          return message;
        }}
      />
      <DiscountSheet
        visible={editingDiscount}
        discountBp={maxBp}
        onClose={() => setEditingDiscount(false)}
        onSave={async (next) => {
          const message = await run(
            () => api.business['community-discount'].$put({ json: { discountBp: next } }),
            next ? 'Neighbours discount saved' : 'Neighbours discount off',
          );
          if (!message) setEditingDiscount(false);
          return message;
        }}
      />
    </>
  );
}

// A community never pays less than the hub: the rule only adds to it.
const QUICK_RULES = [
  { bp: 0, label: 'Same as hub' },
  { bp: 500, label: '5% more' },
  { bp: 1000, label: '10% more' },
  { bp: 1500, label: '15% more' },
  { bp: 2000, label: '20% more' },
];

const DIRECTIONS = [
  { value: 'same', label: 'Same as hub' },
  { value: 'more', label: 'More than hub' },
] as const;

function RuleSheet({
  visible,
  className,
  rule,
  classOnly,
  onClose,
  onSave,
}: {
  visible: boolean;
  className: string;
  rule: Adjustment | null;
  classOnly: boolean;
  onClose: () => void;
  onSave: (next: { percentBp: number; classOnly: boolean }) => Promise<string | null>;
}) {
  const [direction, setDirection] = useState<'same' | 'more'>('more');
  const [percent, setPercent] = useState('10');
  const [scope, setScope] = useState<'all' | 'class'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const bp = rule?.percentBp ?? 0;
    setDirection(bp > 0 || !rule ? 'more' : 'same');
    setPercent(bp > 0 ? bpToText(bp) : '10');
    setScope(classOnly ? 'class' : 'all');
    setError(null);
  }, [visible, rule, classOnly]);

  const submit = async () => {
    let bp = 0;
    if (direction !== 'same') {
      const parsed = textToBp(percent);
      if (parsed == null || parsed <= 0) return setError('Enter a percentage, like 10.');
      if (parsed > 200 * BP_PER_PERCENT) return setError('Up to 200% more.');
      bp = parsed;
    }
    setSaving(true);
    const message = await onSave({ percentBp: bp, classOnly: scope === 'class' });
    setSaving(false);
    if (message) setError(message);
  };

  const example = 50000;
  const exampleAfter = Math.round((example * (10_000 + (direction === 'same' ? 0 : (textToBp(percent) ?? 0)))) / 10_000);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Community rule"
      subtitle="Every community price is the hub price plus this, ending in 9. Never less than the hub."
      footer={<Button label="Save" size="lg" loading={saving} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <ChoiceChips label="Community price is" options={DIRECTIONS} value={direction} onChange={setDirection} />
        {direction !== 'same' ? (
          <TextField
            label={`How much ${direction} (%)`}
            value={percent}
            onChangeText={setPercent}
            keyboardType="decimal-pad"
            maxLength={5}
            hint={`A ${formatRupees(example)} hub wash → ${formatRupees(Math.max(0, exampleAfter))} at a community (before it ends in 9)`}
          />
        ) : null}
        <ChoiceChips
          label="For"
          options={[
            { value: 'all', label: 'All vehicles' },
            { value: 'class', label: `Only ${className.toLowerCase()}` },
          ]}
          value={scope}
          onChange={setScope}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const DISCOUNT_CHOICES = [0, 500, 1000, 1500, 2000].filter((bp) => bp <= JOIN_DISCOUNT_MAX_BP);

function DiscountSheet({
  visible,
  discountBp,
  onClose,
  onSave,
}: {
  visible: boolean;
  discountBp: number;
  onClose: () => void;
  onSave: (discountBp: number) => Promise<string | null>;
}) {
  const [value, setValue] = useState(String(discountBp));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValue(String(discountBp));
    setError(null);
  }, [visible, discountBp]);

  const bp = Number(value);
  const submit = async () => {
    setSaving(true);
    const message = await onSave(bp);
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Neighbours discount"
      subtitle="Off every community price when every flat washes with us"
      footer={<Button label="Save" size="lg" loading={saving} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <ChoiceChips
          label="When every flat joins"
          options={DISCOUNT_CHOICES.map((c) => ({ value: String(c), label: c ? `${pct(c)} off` : 'Off' }))}
          value={value}
          onChange={setValue}
        />
        <Text style={styles.hint}>
          {bp
            ? `It grows with the community: every 10% of its flats that join takes ${pct(bp / 10)} off for everyone there. 7 of 10 flats → ${pct((bp * 7) / 10)} off. A price never goes below the hub price, whatever the discount.`
            : 'Communities pay the community price, however many flats join.'}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  note: { ...typography.body, color: colors.slateDeep, fontSize: 13.5, lineHeight: 19, paddingHorizontal: spacing.md },
  error: { ...typography.label, color: colors.danger },
  hint: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },

  ownNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  ownCopy: { flex: 1, gap: 2, minWidth: 0 },
  ownTitle: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.amberDeep },
  ownBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  ownAction: { ...typography.label, fontSize: 13.5, fontWeight: '800', color: colors.amberDeep },

  ladder: { gap: spacing.sm },
  ladderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ladderLabelCol: { width: 118, gap: 1 },
  ladderLabel: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.waterInk },
  ladderOff: { ...typography.caption, fontSize: 12, color: TONE.community.ink, fontWeight: '700', letterSpacing: 0 },
  ladderTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: TONE.community.pale, overflow: 'hidden' },
  ladderBar: { height: 10, borderRadius: 5, backgroundColor: TONE.community.main },
  ladderPriceCol: { width: 70, alignItems: 'flex-end' },
  ladderPrice: { textAlign: 'right', ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  ladderHub: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0 },

  form: { gap: spacing.md },
});
