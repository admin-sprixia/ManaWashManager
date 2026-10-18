import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  IconClose,
  IconPlus,
  IconUsers,
  TextField,
  colors,
  showAlert,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import {
  BP_PER_PERCENT,
  COMMUNITY_TIER_MAX_BP,
  COMMUNITY_TIERS_MAX,
  communityTiersProblem,
  lessDiscount,
  type CommunityTier,
} from '@mana/domain';
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
 * Communities: many cars at one place on a wash day share the team's travel, so each pays less.
 * A size's own community price wins; otherwise the hub price with the rule. Bigger communities
 * can earn a volume discount on top.
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
  /** A community price to show the volume discount on, like Basic Wash · S at ₹449. */
  example: { name: string; price: number } | null;
}) {
  const cls = catalog.classes.find((c) => c.id === classId);
  const own = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId === classId) ?? null;
  const all = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null) ?? null;
  const rule = own ?? all;
  const tiers = catalog.away.communityTiers;
  const [editingRule, setEditingRule] = useState(false);
  const [editingTiers, setEditingTiers] = useState(false);
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

  // The ladder: below the first step, then each step, with the example price.
  const ladder = [
    { label: tiers[0] ? `1–${tiers[0].minCars - 1} cars` : 'Any number of cars', off: 0 },
    ...tiers.map((t, i) => ({
      label: tiers[i + 1] ? `${t.minCars}–${tiers[i + 1]!.minCars - 1} cars` : `${t.minCars}+ cars`,
      off: t.discountBp,
    })),
  ];
  const maxOff = Math.max(1, ...ladder.map((l) => l.off));

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
        title="Bigger communities pay less"
        subtitle={
          tiers.length
            ? `Up to ${COMMUNITY_TIER_MAX_BP / BP_PER_PERCENT}% off, counted from the cars on a community’s list.`
            : `Off. Add steps so communities with more cars pay less (up to ${COMMUNITY_TIER_MAX_BP / BP_PER_PERCENT}%).`
        }
        onEdit={() => setEditingTiers(true)}
        editLabel={tiers.length ? 'Edit' : 'Add'}
      >
        {tiers.length ? (
          <View style={styles.ladder}>
            {ladder.map((l) => (
              <View key={l.label} style={styles.ladderRow}>
                <View style={styles.ladderLabelCol}>
                  <Text style={styles.ladderLabel}>{l.label}</Text>
                  <Text style={styles.ladderOff}>{l.off ? `${pct(l.off)} off` : 'Community price'}</Text>
                </View>
                <View style={styles.ladderTrack}>
                  <View style={[styles.ladderBar, { width: `${Math.max(8, (l.off / maxOff) * 100)}%`, opacity: l.off ? 1 : 0.35 }]} />
                </View>
                <Text style={styles.ladderPrice}>{example ? formatRupees(l.off ? lessDiscount(example.price, l.off) : example.price) : ''}</Text>
              </View>
            ))}
            {example ? <Text style={partStyles.note}>Prices are for {example.name}. Every wash and plan at that community gets the same %.</Text> : null}
          </View>
        ) : (
          <Pressable
            onPress={() => setEditingTiers(true)}
            style={({ pressed }) => [styles.emptyLadder, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconUsers size={20} color={TONE.community.main} />
            <Text style={styles.emptyLadderText}>Like 10+ cars → 5% off, 25+ cars → 10% off</Text>
          </Pressable>
        )}
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
      <TiersSheet
        visible={editingTiers}
        tiers={tiers}
        onClose={() => setEditingTiers(false)}
        onSave={async (next) => {
          const message = await run(
            () => api.business['community-tiers'].$put({ json: { tiers: next } }),
            next.length ? 'Volume discount saved' : 'Volume discount off',
          );
          if (!message) setEditingTiers(false);
          return message;
        }}
      />
    </>
  );
}

const QUICK_RULES = [
  { bp: 0, label: 'Same as hub' },
  { bp: -500, label: '5% less' },
  { bp: -1000, label: '10% less' },
  { bp: -1500, label: '15% less' },
  { bp: -2000, label: '20% less' },
];

const DIRECTIONS = [
  { value: 'less', label: 'Less than hub' },
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
  const [direction, setDirection] = useState<'less' | 'same' | 'more'>('less');
  const [percent, setPercent] = useState('10');
  const [scope, setScope] = useState<'all' | 'class'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const bp = rule?.percentBp ?? 0;
    setDirection(bp < 0 ? 'less' : bp > 0 ? 'more' : 'same');
    setPercent(bp ? bpToText(Math.abs(bp)) : '10');
    setScope(classOnly ? 'class' : 'all');
    setError(null);
  }, [visible, rule, classOnly]);

  const submit = async () => {
    let bp = 0;
    if (direction !== 'same') {
      const parsed = textToBp(percent);
      if (parsed == null || parsed <= 0) return setError('Enter a percentage, like 10.');
      if (direction === 'less' && parsed > 90 * BP_PER_PERCENT) return setError('Up to 90% less.');
      if (direction === 'more' && parsed > 200 * BP_PER_PERCENT) return setError('Up to 200% more.');
      bp = direction === 'less' ? -parsed : parsed;
    }
    setSaving(true);
    const message = await onSave({ percentBp: bp, classOnly: scope === 'class' });
    setSaving(false);
    if (message) setError(message);
  };

  const example = 50000;
  const exampleAfter = Math.round((example * (10_000 + (direction === 'same' ? 0 : (direction === 'less' ? -1 : 1) * (textToBp(percent) ?? 0)))) / 10_000);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Community rule"
      subtitle="Every community price is the hub price with this rule"
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
            hint={`A ${formatRupees(example)} hub wash → ${formatRupees(Math.max(0, exampleAfter))} at a community (before rounding)`}
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

interface TierDraft {
  key: number;
  cars: string;
  percent: string;
}

function TiersSheet({
  visible,
  tiers,
  onClose,
  onSave,
}: {
  visible: boolean;
  tiers: CommunityTier[];
  onClose: () => void;
  onSave: (tiers: CommunityTier[]) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<TierDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setRows(
      tiers.length
        ? tiers.map((t, i) => ({ key: i, cars: String(t.minCars), percent: bpToText(t.discountBp) }))
        : [
            { key: 0, cars: '5', percent: '5' },
            { key: 1, cars: '10', percent: '10' },
          ],
    );
    setError(null);
  }, [visible, tiers]);

  const update = (key: number, patch: Partial<TierDraft>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  };

  const submit = async (list: TierDraft[]) => {
    const parsed: CommunityTier[] = [];
    for (const r of list) {
      const cars = Number(r.cars);
      const bp = textToBp(r.percent);
      if (!Number.isInteger(cars) || bp == null) return setError('Enter whole cars and a percentage on each step.');
      parsed.push({ minCars: cars, discountBp: bp });
    }
    const problem = communityTiersProblem(parsed);
    if (problem) return setError(problem);
    setSaving(true);
    const message = await onSave(parsed);
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Volume discount"
      subtitle="From this many cars at one community, this much off"
      footer={
        <View style={styles.footer}>
          <Button label="Save" size="lg" loading={saving} onPress={() => void submit(rows)} />
          {tiers.length ? <Button label="Turn off" variant="ghost" disabled={saving} onPress={() => void submit([])} /> : null}
        </View>
      }
    >
      <View style={styles.form}>
        {rows.map((r) => (
          <View key={r.key} style={styles.tierRow}>
            <View style={styles.tierBox}>
              <TextInput
                style={styles.tierInput}
                value={r.cars}
                onChangeText={(t) => update(r.key, { cars: t.replace(/\D/g, '') })}
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="From this many cars"
              />
              <Text style={styles.tierUnit}>+ cars</Text>
            </View>
            <Text style={styles.tierArrow}>→</Text>
            <View style={styles.tierBox}>
              <TextInput
                style={styles.tierInput}
                value={r.percent}
                onChangeText={(t) => update(r.key, { percent: t })}
                keyboardType="decimal-pad"
                maxLength={4}
                accessibilityLabel="Percent off"
              />
              <Text style={styles.tierUnit}>% off</Text>
            </View>
            <Pressable
              onPress={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
              hitSlop={8}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Remove this step"
            >
              <IconClose size={16} color={colors.slateDeep} />
            </Pressable>
          </View>
        ))}
        {rows.length < COMMUNITY_TIERS_MAX ? (
          <Pressable
            onPress={() => {
              const last = rows[rows.length - 1];
              setRows((prev) => [
                ...prev,
                {
                  key: Math.max(-1, ...prev.map((x) => x.key)) + 1,
                  cars: last ? String(Number(last.cars || '0') + 10) : '5',
                  percent: last ? String(Number(last.percent || '0') + 5) : '5',
                },
              ]);
            }}
            style={({ pressed }) => [styles.addStep, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconPlus size={16} color={colors.indigo} />
            <Text style={styles.addStepText}>Add a step</Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>
          More cars should get a bigger discount, up to {COMMUNITY_TIER_MAX_BP / BP_PER_PERCENT}% however many cars there are. It comes off
          the community price, plans included.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
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
  ladderPrice: { width: 64, textAlign: 'right', ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  emptyLadder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: TONE.community.line,
    backgroundColor: TONE.community.pale,
  },
  emptyLadderText: { flex: 1, ...typography.label, fontSize: 13.5, color: TONE.community.ink, fontWeight: '700' },

  form: { gap: spacing.md },
  footer: { gap: spacing.xs },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
  },
  tierInput: { flex: 1, paddingVertical: spacing.sm + 2, fontSize: 17, fontWeight: '800', color: colors.waterInk },
  tierUnit: { fontSize: 13.5, fontWeight: '700', color: colors.slateDeep },
  tierArrow: { fontSize: 16, color: colors.slate, fontWeight: '800' },
  remove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  addStep: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  addStepText: { ...typography.label, color: colors.indigo, fontWeight: '800' },
});
