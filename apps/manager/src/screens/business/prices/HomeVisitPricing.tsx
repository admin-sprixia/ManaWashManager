import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  FieldLabel,
  IconClock,
  IconHome,
  IconMapPin,
  IconPlus,
  IconRupee,
  TextField,
  colors,
  radius,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import {
  WEEKDAY_SHORT,
  addDaysTo,
  doorstepRulesProblem,
  istInstant,
  visitCharge,
  type BusyExtra,
  type DoorstepVisitRules,
} from '@mana/domain';
import { api } from '../../../api/client';
import { formatRupees, parseRupees } from '../../../utils/format';
import { TimeField } from '../../places/review/TimeField';
import { paiseToText, plural, type Catalog, type useCatalog } from '../shared';
import { Panel, StatTile, TONE, partStyles } from './parts';

type Run = ReturnType<typeof useCatalog>['run'];

/** A Sunday, so "Sunday + n days" lands on weekday n for trying a busy time. */
const SAMPLE_SUNDAY = '2026-01-04';
const atBusy = (b: BusyExtra) => istInstant(addDaysTo(SAMPLE_SUNDAY, b.days[0] ?? 0), b.from);
const daysText = (days: number[]) =>
  days.length === 7 ? 'Every day' : [...days].sort().map((d) => WEEKDAY_SHORT[d]).join(', ');
const kmText = (km: number) => `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
const SAMPLE_KM = [2, 5, 8, 12, 15, 20];

/**
 * Home visits: the hub price plus one visit charge per visit (a visit fee, then per km beyond
 * the free distance, up to the furthest the team goes), plus any busy-time extra.
 */
export function HomeVisitPricing({
  catalog,
  run,
  classId,
  hubPrice,
}: {
  catalog: Catalog;
  run: Run;
  classId: string;
  /** The hub price of a service for a size (with unsaved edits), or null. */
  hubPrice: (serviceId: string, sizeId: string) => number | null;
}) {
  const rules = catalog.away.doorstep;
  const [editingRules, setEditingRules] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [rounding, setRounding] = useState(false);

  const save = (next: DoorstepVisitRules, done: string) =>
    run(() => api.business['doorstep-rules'].$put({ json: next }), done);

  const toggleRound = async (on: boolean) => {
    setRounding(true);
    const message = await save({ ...rules, roundTo9: on }, on ? 'Visit charges end in 9' : 'Visit charges aren’t rounded');
    setRounding(false);
    if (message) showAlert('Couldn’t save', message);
  };
  const edit = () => setEditingRules(true);

  return (
    <>
      {!catalog.homeWash ? (
        <Text style={styles.note}>No branch washes at homes yet. Set this now and it’s ready when one starts.</Text>
      ) : null}

      <Panel
        title="Visit charge"
        subtitle="Added once to every home visit, on top of the hub price. Two cars at one home pay it once."
        onEdit={edit}
      >
        <View style={partStyles.tileRow}>
          <StatTile
            tone="home"
            icon={<IconRupee size={15} color={TONE.home.main} />}
            label="Visit fee"
            value={formatRupees(rules.visitFeePaise)}
            hint="Every visit, however near"
            onPress={edit}
          />
          <StatTile
            tone="home"
            icon={<IconMapPin size={15} color={TONE.home.main} />}
            label="Free distance"
            value={kmText(rules.freeKm)}
            hint="Within this, just the visit fee"
            onPress={edit}
          />
        </View>
        <View style={partStyles.tileRow}>
          <StatTile
            tone="home"
            icon={<IconMapPin size={15} color={TONE.home.main} />}
            label="Then per km"
            value={rules.perKmPaise ? formatRupees(rules.perKmPaise) : 'Free'}
            hint="For every km, or part of one"
            onPress={edit}
          />
          <StatTile
            tone="home"
            icon={<IconHome size={15} color={TONE.home.main} />}
            label="Furthest"
            value={kmText(rules.maxKm)}
            hint="Homes further away can’t book"
            onPress={edit}
          />
        </View>
        <View style={styles.roundRow}>
          <View style={styles.nineBadge}>
            <Text style={styles.nine}>9</Text>
          </View>
          <View style={styles.roundCopy}>
            <Text style={styles.roundTitle}>End in 9</Text>
            <Text style={styles.roundBody}>
              {rules.roundTo9 ? 'On: ₹64 becomes ₹69, ₹91 becomes ₹99.' : 'Off: charged exactly as it adds up, like ₹64.'}
            </Text>
          </View>
          <Switch
            value={rules.roundTo9}
            disabled={rounding}
            onValueChange={(on) => void toggleRound(on)}
            trackColor={{ false: colors.border, true: TONE.home.line }}
            thumbColor={rules.roundTo9 ? TONE.home.main : colors.white}
            accessibilityLabel="End visit charges in 9"
          />
        </View>
      </Panel>

      <Panel
        title="Busy times"
        subtitle="An extra on home visits at your busiest hours. The team is in demand then, so it costs a little more."
        onEdit={() => setBusy('new')}
        editLabel="Add"
      >
        {rules.busy.map((b, i) => (
          <Pressable
            key={`${i}-${b.from}`}
            onPress={() => setBusy(i)}
            style={({ pressed }) => [styles.busyCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Busy time ${daysText(b.days)} ${b.from} to ${b.to}, plus ${formatRupees(b.extraPaise)}`}
          >
            <View style={styles.busyIcon}>
              <IconClock size={18} color={TONE.amber.ink} />
            </View>
            <View style={styles.busyCopy}>
              <Text style={styles.busyTime}>
                {b.from} – {b.to}
              </Text>
              <View style={styles.dayDots}>
                {WEEKDAY_SHORT.map((d, n) => (
                  <View key={d} style={[styles.dayDot, b.days.includes(n) && styles.dayDotOn]}>
                    <Text style={[styles.dayDotText, b.days.includes(n) && styles.dayDotTextOn]}>{d.slice(0, 1)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={styles.busyExtra}>+{formatRupees(b.extraPaise)}</Text>
          </Pressable>
        ))}
        {rules.busy.length === 0 ? (
          <Pressable
            onPress={() => setBusy('new')}
            style={({ pressed }) => [styles.emptyBusy, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconPlus size={18} color={TONE.amber.ink} />
            <Text style={styles.emptyBusyText}>None yet. Add one like +₹30 on Sunday 7–11 am.</Text>
          </Pressable>
        ) : null}
      </Panel>

      <DistanceChart rules={rules} />
      <Calculator catalog={catalog} classId={classId} rules={rules} hubPrice={hubPrice} />

      <VisitSheet
        visible={editingRules}
        rules={rules}
        onClose={() => setEditingRules(false)}
        onSave={async (next) => {
          const message = await save(next, 'Visit charge saved · new home washes use it');
          if (!message) setEditingRules(false);
          return message;
        }}
      />
      <BusySheet
        visible={busy != null}
        extra={typeof busy === 'number' ? (rules.busy[busy] ?? null) : null}
        onClose={() => setBusy(null)}
        onSave={async (extra) => {
          const list = [...rules.busy];
          if (typeof busy === 'number') list[busy] = extra;
          else list.push(extra);
          const next = { ...rules, busy: list };
          const problem = doorstepRulesProblem(next);
          if (problem) return problem;
          const message = await save(next, 'Busy time saved');
          if (!message) setBusy(null);
          return message;
        }}
        onRemove={
          typeof busy === 'number'
            ? async () => {
                const message = await save({ ...rules, busy: rules.busy.filter((_, i) => i !== busy) }, 'Busy time removed');
                if (!message) setBusy(null);
                return message;
              }
            : undefined
        }
      />
    </>
  );
}

/** What the visit charge comes to at a few distances, as bars. */
function DistanceChart({ rules }: { rules: DoorstepVisitRules }) {
  const calm = { ...rules, busy: [] };
  const now = new Date();
  const distances = [...new Set([rules.freeKm, 5, 8, 10, 12, rules.maxKm])]
    .filter((d) => d >= rules.freeKm && d <= rules.maxKm)
    .sort((a, b) => a - b);
  const max = Math.max(1, visitCharge(rules.maxKm, calm, now).total);
  return (
    <Panel title="Visit charge by distance" subtitle="From the branch to the home, by road.">
      {distances.map((d, i) => {
        const total = visitCharge(d, calm, now).total;
        return (
          <View key={d} style={styles.barRow}>
            <Text style={styles.barKm}>{i === 0 ? `0–${kmText(d)}` : kmText(d)}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { width: `${Math.max(6, (total / max) * 100)}%` }]} />
            </View>
            <Text style={styles.barAmount}>{formatRupees(total)}</Text>
          </View>
        );
      })}
      <View style={styles.barRow}>
        <Text style={[styles.barKm, styles.muted]}>Over {kmText(rules.maxKm)}</Text>
        <View style={[styles.barTrack, styles.barTrackOff]} />
        <Text style={[styles.barAmount, styles.muted]}>Not served</Text>
      </View>
    </Panel>
  );
}

/** Try it: a service, a size, a distance and a time → what the customer pays. */
function Calculator({
  catalog,
  classId,
  rules,
  hubPrice,
}: {
  catalog: Catalog;
  classId: string;
  rules: DoorstepVisitRules;
  hubPrice: (serviceId: string, sizeId: string) => number | null;
}) {
  const cls = catalog.classes.find((c) => c.id === classId);
  const services = catalog.services.filter((s) => s.active && s.classIds.includes(classId) && s.places.doorstep);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [km, setKm] = useState(5);
  const [kmTextValue, setKmTextValue] = useState('5');
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? services.find((s) => s.popular) ?? services[0] ?? null;
  const sizes = (cls?.sizes ?? []).filter((z) => service?.sizeIds.includes(z.id) && hubPrice(service.id, z.id) != null);
  const size = sizes.find((z) => z.id === sizeId) ?? sizes[0] ?? null;

  useEffect(() => {
    if (busyIndex != null && busyIndex >= rules.busy.length) setBusyIndex(null);
  }, [busyIndex, rules.busy.length]);

  const result = useMemo(() => {
    const picked = busyIndex != null ? rules.busy[busyIndex] : undefined;
    const at = picked ? atBusy(picked) : null;
    return visitCharge(km, at ? rules : { ...rules, busy: [] }, at ?? new Date());
  }, [km, rules, busyIndex]);

  if (!cls || !service) {
    return (
      <>
        <Panel title="Try it" subtitle={`No ${cls?.name.toLowerCase() ?? 'vehicle'} service is done at homes. Tick Doorstep on one in Services.`} />
      </>
    );
  }
  const base = size ? hubPrice(service.id, size.id) : null;

  return (
    <>
      <Panel title="Try it" subtitle="Pick a wash, a size and how far the home is: see what the customer pays.">
        <FieldLabel>Service</FieldLabel>
        <View style={styles.chipRow}>
          {services.map((s) => (
            <Chip key={s.id} label={s.name} on={s.id === service.id} onPress={() => setServiceId(s.id)} />
          ))}
        </View>
        {sizes.length > 1 ? (
          <>
            <FieldLabel>Size</FieldLabel>
            <View style={styles.chipRow}>
              {sizes.map((z) => (
                <Chip key={z.id} label={z.key} on={z.id === size?.id} onPress={() => setSizeId(z.id)} />
              ))}
            </View>
          </>
        ) : null}
        <FieldLabel>How far is the home?</FieldLabel>
        <View style={styles.chipRow}>
          {SAMPLE_KM.map((d) => (
            <Chip
              key={d}
              label={kmText(d)}
              on={km === d}
              onPress={() => {
                setKm(d);
                setKmTextValue(String(d));
              }}
            />
          ))}
          <View style={styles.kmBox}>
            <TextInput
              style={styles.kmInput}
              value={kmTextValue}
              onChangeText={(t) => {
                setKmTextValue(t);
                const n = Number(t);
                if (t.trim() && Number.isFinite(n) && n >= 0 && n <= 500) setKm(n);
              }}
              keyboardType="decimal-pad"
              maxLength={5}
              accessibilityLabel="Distance in km"
            />
            <Text style={styles.kmUnit}>km</Text>
          </View>
        </View>
        {rules.busy.length ? (
          <>
            <FieldLabel>When?</FieldLabel>
            <View style={styles.chipRow}>
              <Chip label="Normal time" on={busyIndex == null} onPress={() => setBusyIndex(null)} />
              {rules.busy.map((b, i) => (
                <Chip
                  key={`${i}-${b.from}`}
                  label={`${daysText(b.days)} ${b.from}`}
                  on={busyIndex === i}
                  onPress={() => setBusyIndex(i)}
                />
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.bill}>
          {result.tooFar ? (
            <Text style={styles.tooFar}>
              {kmText(result.km)} is further than the team goes ({kmText(rules.maxKm)}). This home can’t book a visit.
            </Text>
          ) : (
            <>
              <BillLine label={`${service.name}${size ? ` · ${size.key}` : ''}`} amount={base} />
              {result.steps.map((s) => (
                <BillLine key={s.label} label={s.label} amount={s.amount} small />
              ))}
              <View style={styles.billTotal}>
                <Text style={styles.billTotalLabel}>Customer pays</Text>
                <Text style={styles.billTotalAmount}>{base == null ? '—' : formatRupees(base + result.total)}</Text>
              </View>
              {base != null ? (
                <Text style={styles.billNote}>
                  A second car at the same home in the same visit: {formatRupees(base)} (no second visit charge).
                </Text>
              ) : null}
            </>
          )}
        </View>
      </Panel>
    </>
  );
}

function BillLine({ label, amount, small }: { label: string; amount: number | null; small?: boolean }) {
  return (
    <View style={styles.billLine}>
      <Text style={[styles.billLabel, small && styles.billSmall]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.billAmount, small && styles.billSmall]}>{amount == null ? '—' : formatRupees(amount)}</Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const YES_NO = [
  { value: 'yes', label: 'Yes, like ₹99' },
  { value: 'no', label: 'No' },
] as const;

function VisitSheet({
  visible,
  rules,
  onClose,
  onSave,
}: {
  visible: boolean;
  rules: DoorstepVisitRules;
  onClose: () => void;
  onSave: (rules: DoorstepVisitRules) => Promise<string | null>;
}) {
  const [fee, setFee] = useState('');
  const [freeKm, setFreeKm] = useState('');
  const [perKm, setPerKm] = useState('');
  const [maxKm, setMaxKm] = useState('');
  const [round, setRound] = useState<'yes' | 'no'>('yes');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFee(paiseToText(rules.visitFeePaise));
    setFreeKm(String(rules.freeKm));
    setPerKm(paiseToText(rules.perKmPaise));
    setMaxKm(String(rules.maxKm));
    setRound(rules.roundTo9 ? 'yes' : 'no');
    setError(null);
  }, [visible, rules]);

  const submit = async () => {
    const feePaise = parseRupees(fee) ?? 0;
    const perKmPaise = parseRupees(perKm) ?? 0;
    const free = Number(freeKm || '0');
    const max = Number(maxKm);
    if (Number.isNaN(feePaise) || Number.isNaN(perKmPaise)) return setError('Enter rupees, like 49.');
    if (!Number.isFinite(free) || !Number.isFinite(max) || !maxKm.trim()) return setError('Enter the distances in km.');
    const next: DoorstepVisitRules = {
      ...rules,
      visitFeePaise: feePaise,
      perKmPaise,
      freeKm: Math.round(free * 10) / 10,
      maxKm: Math.round(max * 10) / 10,
      roundTo9: round === 'yes',
    };
    const problem = doorstepRulesProblem(next);
    if (problem) return setError(problem);
    setSaving(true);
    const message = await onSave(next);
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Visit charge"
      subtitle="Added once to every home visit, on top of the hub price"
      footer={<Button label="Save" size="lg" loading={saving} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <TextField label="Visit fee (₹)" value={fee} onChangeText={setFee} keyboardType="numeric" maxLength={5} hint="Every visit, however near" />
        <View style={styles.twoCol}>
          <View style={styles.flex}>
            <TextField label="Free distance (km)" value={freeKm} onChangeText={setFreeKm} keyboardType="decimal-pad" maxLength={4} />
          </View>
          <View style={styles.flex}>
            <TextField label="Then per km (₹)" value={perKm} onChangeText={setPerKm} keyboardType="numeric" maxLength={4} />
          </View>
        </View>
        <TextField
          label="Furthest the team goes (km)"
          value={maxKm}
          onChangeText={setMaxKm}
          keyboardType="decimal-pad"
          maxLength={4}
          hint="Homes further than this can’t book a visit"
        />
        <ChoiceChips label="Round up to end in 9?" options={YES_NO} value={round} onChange={setRound} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function BusySheet({
  visible,
  extra,
  onClose,
  onSave,
  onRemove,
}: {
  visible: boolean;
  extra: BusyExtra | null;
  onClose: () => void;
  onSave: (extra: BusyExtra) => Promise<string | null>;
  onRemove?: () => Promise<string | null>;
}) {
  const [days, setDays] = useState<number[]>([0]);
  const [from, setFrom] = useState('07:00');
  const [to, setTo] = useState('11:00');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDays(extra?.days ?? [0]);
    setFrom(extra?.from ?? '07:00');
    setTo(extra?.to ?? '11:00');
    setAmount(paiseToText(extra?.extraPaise ?? null));
    setError(null);
  }, [visible, extra]);

  const toggle = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const submit = async () => {
    const paise = parseRupees(amount);
    if (!days.length) return setError('Pick at least one day.');
    if (paise == null || Number.isNaN(paise) || paise <= 0) return setError('Enter the extra in rupees, like 30.');
    if (to <= from) return setError('The busy time has to end after it starts.');
    setSaving(true);
    const message = await onSave({ days, from, to, extraPaise: paise });
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={extra ? 'Busy time' : 'Add a busy time'}
      subtitle="An extra on home visits at these times"
      footer={
        <View style={styles.footer}>
          <Button label="Save" size="lg" loading={saving} onPress={() => void submit()} />
          {onRemove ? (
            <Button
              label="Remove"
              variant="ghost"
              disabled={saving}
              onPress={() => {
                setSaving(true);
                void onRemove().then((message) => {
                  setSaving(false);
                  if (message) setError(message);
                });
              }}
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.form}>
        <FieldLabel>Days</FieldLabel>
        <View style={styles.dayRow}>
          {WEEKDAY_SHORT.map((label, d) => (
            <Chip key={label} label={label} on={days.includes(d)} onPress={() => toggle(d)} />
          ))}
        </View>
        <TimeField label="From" value={from} onChange={setFrom} />
        <TimeField label="To" value={to} onChange={setTo} />
        <TextField label="Extra (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" maxLength={5} placeholder="30" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

export const visitSummary = (rules: DoorstepVisitRules) =>
  `${formatRupees(rules.visitFeePaise)} visit${rules.perKmPaise ? ` + ${formatRupees(rules.perKmPaise)}/km after ${kmText(rules.freeKm)}` : ''}${
    rules.busy.length ? ` · ${plural(rules.busy.length, 'busy time')}` : ''
  }`;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  note: { ...typography.body, color: colors.slateDeep, fontSize: 13.5, lineHeight: 19, paddingHorizontal: spacing.md },
  error: { ...typography.label, color: colors.danger },
  muted: { color: colors.slate },
  nine: { fontSize: 18, fontWeight: '900', color: colors.white },

  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  nineBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: TONE.home.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundCopy: { flex: 1, gap: 2, minWidth: 0 },
  roundTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  roundBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },

  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    backgroundColor: TONE.amber.pale,
    borderWidth: 1,
    borderColor: TONE.amber.line,
  },
  busyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  busyCopy: { flex: 1, gap: 6, minWidth: 0 },
  busyTime: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },
  busyExtra: { ...typography.heading, fontSize: 20, color: TONE.amber.ink },
  dayDots: { flexDirection: 'row', gap: 4 },
  dayDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  dayDotOn: { backgroundColor: TONE.amber.ink },
  dayDotText: { fontSize: 11, fontWeight: '800', color: colors.slate },
  dayDotTextOn: { color: colors.white },
  emptyBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: TONE.amber.line,
    backgroundColor: TONE.amber.pale,
  },
  emptyBusyText: { flex: 1, ...typography.label, fontSize: 13.5, color: TONE.amber.ink, fontWeight: '700' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barKm: { width: 84, ...typography.label, fontSize: 13.5, color: colors.waterInk, fontWeight: '700' },
  barTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: TONE.home.pale, overflow: 'hidden' },
  barTrackOff: { backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  bar: { height: 12, borderRadius: 6, backgroundColor: TONE.home.main },
  barAmount: { width: 78, textAlign: 'right', ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginBottom: spacing.xs },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    maxWidth: 220,
  },
  chipOn: { backgroundColor: colors.tealDeep, borderColor: colors.tealDeep },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.slateDeep },
  chipTextOn: { color: colors.white },
  kmBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: colors.surface,
  },
  kmInput: { minWidth: 36, paddingVertical: 6, fontSize: 14, fontWeight: '800', color: colors.waterInk, textAlign: 'right' },
  kmUnit: { fontSize: 13, fontWeight: '700', color: colors.slateDeep, marginLeft: 3 },

  bill: { marginTop: spacing.xs, padding: spacing.sm + 4, gap: 6, borderRadius: radius.lg, backgroundColor: colors.surface },
  billLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  billLabel: { flex: 1, ...typography.body, fontSize: 14.5, color: colors.waterInk },
  billAmount: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  billSmall: { fontSize: 13.5, color: colors.slateDeep },
  billTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  billTotalLabel: { flex: 1, ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  billTotalAmount: { ...typography.heading, fontSize: 20, color: colors.tealDeep },
  billNote: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  tooFar: { ...typography.body, fontSize: 14, color: colors.danger, lineHeight: 20 },

  form: { gap: spacing.md },
  twoCol: { flexDirection: 'row', gap: spacing.sm },
  footer: { gap: spacing.xs },
});
