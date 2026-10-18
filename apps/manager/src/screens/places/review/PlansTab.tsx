import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatInr, unitLabel } from '@mana/domain';
import { IconTag, Pill, colors, radius, spacing, typography } from '@mana/ui';
import { UnitTile } from '../kit';
import { TEAL, TEAL_MIST, TEAL_PALE } from '../panel/parts';
import { PHASE_STAFF_LABEL, PHASE_STAFF_TONE, type PlaceMember, type StaffMenu } from '../shared';
import { BikeIcon, CarIcon } from '../visit/VehicleIcons';
import { flatTotal, isUnpaid, memberVehicles, monthlyValue, type MemberVehicle } from './memberFlats';
import type { ReviewContext, ReviewTab } from './types';

type Menu = StaffMenu['menu'];
type Plan = Menu['plans'][number];

const RATES = [0.25, 0.5, 0.75] as const;
const GREEN = '#15803D';
const PLAN_COLORS = ['#0F766E', '#4458CC', '#B45309', '#BE185D', '#0369A1', '#6D28D9'];
const NO_PLAN = 'No plan yet';
/** Flats shown before "and N more". */
const CHIP_LIMIT = 24;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The plan an estimate is worked out on: the "most popular" one, else the first. */
const basePlan = (menu: Menu): Plan | null => menu.plans.find((p) => p.popular) ?? menu.plans[0] ?? null;

/** A plan's average monthly price over the vehicle types of one kind (cars or bikes). */
function monthly(menu: Menu, plan: Plan, category: 'car' | 'bike'): number | null {
  const ids = new Set(menu.vehicleTypes.filter((t) => t.category === category).map((t) => t.id));
  const prices = plan.prices.filter((p) => ids.has(p.vehicleTypeId)).map((p) => p.total / Math.max(1, plan.months));
  return prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
}

/** Before anyone joins: what the community could bring in a month if some of its vehicles join. */
function Estimate({ ctx }: { ctx: ReviewContext }) {
  const [rate, setRate] = useState<(typeof RATES)[number]>(0.5);
  const menu = ctx.menu;
  const plan = menu ? basePlan(menu) : null;
  const { cars, bikes } = ctx.place.setup.inspection;
  if (!menu || !plan || (cars == null && bikes == null)) return null;
  const carPrice = monthly(menu, plan, 'car');
  const bikePrice = monthly(menu, plan, 'bike');
  const joinedCars = Math.round((cars ?? 0) * rate);
  const joinedBikes = Math.round((bikes ?? 0) * rate);
  const total = joinedCars * (carPrice ?? 0) + joinedBikes * (bikePrice ?? 0);
  return (
    <View style={styles.earn}>
      <View style={styles.earnHead}>
        <Text style={styles.earnTitle}>Earnings estimate</Text>
        <RateChips options={RATES.map((r) => ({ value: r, label: `${r * 100}%` }))} value={rate} onChange={setRate} />
      </View>
      <Text style={styles.earnValue}>≈ {formatInr(total)}</Text>
      <Text style={styles.earnSub}>
        a month, if {plural(joinedCars, 'car')} and {plural(joinedBikes, 'bike')} join on the {plan.name}
      </Text>
      <Text style={styles.earnNote}>From the vehicles the visit counted. The real amount depends on the plans people pick.</Text>
    </View>
  );
}

function RateChips<T extends number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.rates} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.label} onPress={() => onChange(o.value)} style={[styles.rate, on && styles.rateOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.rateText, on && styles.rateTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stat({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** "16 of 36 flats · 44%" with a bar. */
function Uptake({ label, part, whole, color }: { label: string; part: number; whole: number | null; color: string }) {
  const share = whole ? Math.min(100, pct(part, whole)) : null;
  return (
    <View style={styles.uptake}>
      <View style={styles.uptakeTop}>
        <Text style={styles.uptakeLabel}>{label}</Text>
        <Text style={[styles.uptakeValue, { color }]}>
          {whole ? `${part} of ${whole}` : part}
          {share != null ? <Text style={styles.uptakePct}>{`  ${share}%`}</Text> : null}
        </Text>
      </View>
      {share != null ? (
        <View style={styles.uptakeBar}>
          <View style={[styles.uptakeFill, { width: `${Math.max(share, 2)}%`, backgroundColor: color }]} />
        </View>
      ) : null}
    </View>
  );
}

/** Flat chips (A · 101, B · 204…), the first few and a count of the rest. */
function FlatChips({ units, tone }: { units: string[]; tone: 'teal' | 'slate' }) {
  const shown = units.slice(0, CHIP_LIMIT);
  return (
    <View style={styles.chips}>
      {shown.map((u) => (
        <View key={u} style={[styles.chip, tone === 'slate' && styles.chipSlate]}>
          <Text style={[styles.chipText, tone === 'slate' && styles.chipTextSlate]}>{u}</Text>
        </View>
      ))}
      {units.length > shown.length ? <Text style={styles.chipMore}>and {units.length - shown.length} more</Text> : null}
    </View>
  );
}

type Row = MemberVehicle & { member: PlaceMember };

interface PlanGroup {
  title: string;
  cars: number;
  bikes: number;
  units: Set<string>;
  monthly: number;
  oneOff: number;
}

function PlansBody({ ctx }: { ctx: ReviewContext }) {
  const members = ctx.members;
  const rows = useMemo<Row[]>(() => members.flatMap((m) => memberVehicles(m).map((v) => ({ ...v, member: m }))), [members]);
  const groups = useMemo(() => {
    const map = new Map<string, PlanGroup>();
    for (const v of rows) {
      const title = v.order?.title ?? NO_PLAN;
      const g = map.get(title) ?? { title, cars: 0, bikes: 0, units: new Set<string>(), monthly: 0, oneOff: 0 };
      if (v.category === 'bike') g.bikes += 1;
      else g.cars += 1;
      g.units.add(v.member.unit);
      g.monthly += monthlyValue(v.order);
      if (v.order?.kind === 'single') g.oneOff += v.order.total;
      map.set(title, g);
    }
    return [...map.values()].sort((a, b) => (a.title === NO_PLAN ? 1 : b.title === NO_PLAN ? -1 : b.cars + b.bikes - (a.cars + a.bikes)));
  }, [rows]);

  const flatsTotal = ctx.units.length;
  const joinedUnits = useMemo(() => new Set(members.map((m) => m.unit)), [members]);
  const notJoined = useMemo(
    () => ctx.units.map((u) => unitLabel(u.block, u.number)).filter((label) => !joinedUnits.has(label)),
    [ctx.units, joinedUnits],
  );
  const counted = (ctx.place.setup.inspection.cars ?? 0) + (ctx.place.setup.inspection.bikes ?? 0);

  const [goal, setGoal] = useState<number | null>(null);

  if (!members.length) {
    return (
      <>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No one has joined yet</Text>
          <Text style={styles.emptyText}>
            Once residents join, you’ll see how many flats took a plan, which plan and which vehicles, and what it brings in.
          </Text>
        </View>
        <Estimate ctx={ctx} />
      </>
    );
  }

  const cars = rows.filter((v) => v.category === 'car').length;
  const bikes = rows.length - cars;
  const onPlan = rows.filter((v) => v.order?.kind === 'plan').length;
  const unpaid = rows.filter((v) => isUnpaid(v.order)).length;
  const monthNow = rows.reduce((n, v) => n + monthlyValue(v.order), 0);
  const collected = rows.reduce((n, v) => n + (v.order?.paid ?? 0), 0);
  const most = Math.max(1, ...groups.map((g) => g.cars + g.bikes));

  // The estimate: what the flats that joined spend a month, on average, × the flats that would join.
  const flatsIn = joinedUnits.size;
  const perFlat = flatsIn ? monthNow / flatsIn : 0;
  const nowShare = flatsTotal ? pct(flatsIn, flatsTotal) : null;
  const goals = [nowShare, 50, 75, 100]
    .filter((g): g is number => g != null)
    .filter((g, i, all) => all.indexOf(g) === i && (i === 0 || g > (nowShare ?? 0)));
  const target = goal ?? goals[0] ?? 100;
  const flatsAtTarget = flatsTotal ? Math.round((flatsTotal * target) / 100) : flatsIn;
  const monthAtTarget = Math.round(perFlat * flatsAtTarget);

  return (
    <>
      <View style={styles.interest}>
        <Text style={styles.cardTitle}>How many joined</Text>
        <Uptake label="Flats" part={flatsIn} whole={flatsTotal || null} color={TEAL} />
        <Uptake label="Vehicles" part={rows.length} whole={counted || null} color="#0369A1" />
        <Text style={styles.cardNote}>
          {flatsTotal
            ? `${nowShare}% of the ${flatsTotal} flats on the list took our service`
            : 'Add the flats list to see what share of the community joined'}
          {counted ? ` · ${pct(rows.length, counted)}% of the ${counted} vehicles counted at the visit` : ''}.
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat value={cars} label={cars === 1 ? 'car' : 'cars'} color={colors.indigo} />
        <Stat value={bikes} label={bikes === 1 ? 'bike' : 'bikes'} color="#0369A1" />
        <Stat value={onPlan} label="on a plan" color={TEAL} />
        <Stat value={unpaid} label="not paid" color={unpaid ? colors.danger : colors.slate} />
      </View>

      <View style={styles.earn}>
        <Text style={styles.earnTitle}>Earnings</Text>
        <View style={styles.money}>
          <View style={styles.moneyItem}>
            <Text style={styles.moneyLabel}>Now, a month</Text>
            <Text style={styles.moneyValue}>{formatInr(monthNow)}</Text>
          </View>
          <View style={styles.moneyRule} />
          <View style={styles.moneyItem}>
            <Text style={styles.moneyLabel}>Collected so far</Text>
            <Text style={[styles.moneyValue, { color: GREEN }]}>{formatInr(collected)}</Text>
          </View>
        </View>
        {flatsTotal > flatsIn && perFlat > 0 ? (
          <>
            <View style={styles.earnHead}>
              <Text style={styles.earnSubTitle}>If more flats join</Text>
              <RateChips
                options={goals.map((g, i) => ({ value: g, label: i === 0 && g === nowShare ? `Now ${g}%` : `${g}%` }))}
                value={target}
                onChange={setGoal}
              />
            </View>
            <Text style={styles.earnValue}>≈ {formatInr(monthAtTarget)}</Text>
            <Text style={styles.earnSub}>
              a month · ≈ {formatInr(monthAtTarget * 12)} a year, with {flatsAtTarget} of {flatsTotal} flats
            </Text>
            <Text style={styles.earnNote}>
              Each flat that joined spends about {formatInr(Math.round(perFlat))} a month; this assumes new flats spend the same.
            </Text>
          </>
        ) : null}
      </View>

      <Text style={styles.label}>Which plan, which flats</Text>
      <View style={styles.plans}>
        {groups.map((g, i) => {
          const color = g.title === NO_PLAN ? colors.slate : PLAN_COLORS[i % PLAN_COLORS.length]!;
          const count = g.cars + g.bikes;
          return (
            <View key={g.title} style={styles.planRow}>
              <View style={styles.planTop}>
                <View style={[styles.planDot, { backgroundColor: color }]} />
                <Text style={styles.planName} numberOfLines={2}>
                  {g.title}
                </Text>
                {g.monthly ? <Text style={[styles.planMoney, { color }]}>{formatInr(g.monthly)}/mo</Text> : null}
              </View>
              <View style={styles.planBar}>
                <View style={[styles.planFill, { width: `${(count / most) * 100}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.planCount}>
                {[g.cars ? plural(g.cars, 'car') : null, g.bikes ? plural(g.bikes, 'bike') : null, plural(g.units.size, 'flat')]
                  .filter(Boolean)
                  .join(' · ')}
                {` · ${pct(count, rows.length)}% of vehicles`}
                {g.oneOff ? ` · ${formatInr(g.oneOff)} one-off` : ''}
              </Text>
              <FlatChips units={[...g.units].sort()} tone={g.title === NO_PLAN ? 'slate' : 'teal'} />
            </View>
          );
        })}
      </View>

      <Text style={styles.label}>Flat by flat</Text>
      {members.map((m) => {
        const list = memberVehicles(m);
        const total = flatTotal(m);
        const perMonth = list.reduce((n, v) => n + monthlyValue(v.order), 0);
        return (
          <View key={m.id} style={styles.flat}>
            <View style={styles.flatHead}>
              <UnitTile unit={m.unit} tone={m.status === 'pending' ? 'danger' : list.some((v) => isUnpaid(v.order)) ? 'slate' : 'teal'} />
              <View style={styles.flatCopy}>
                <Text style={styles.flatName} numberOfLines={1}>
                  {m.customer.name?.trim() || `+91 ${m.customer.phone}`}
                </Text>
                <Text style={styles.flatMeta}>
                  {plural(list.length, 'vehicle')}
                  {m.status === 'pending' ? ' · waiting to be confirmed' : ''}
                </Text>
              </View>
              {total ? (
                <View style={styles.flatMoney}>
                  <Text style={styles.flatTotal}>{formatInr(total)}</Text>
                  {perMonth && perMonth !== total ? <Text style={styles.flatPerMonth}>{formatInr(perMonth)}/mo</Text> : null}
                </View>
              ) : null}
            </View>
            {list.map((v) => (
              <View key={v.id} style={styles.vehicle}>
                <View style={styles.vehicleIcon}>{v.category === 'bike' ? <BikeIcon size={16} /> : <CarIcon size={16} />}</View>
                <View style={styles.vehicleCopy}>
                  <Text style={styles.vehicleLabel} numberOfLines={1}>
                    {v.typeName}
                    {v.plate ? <Text style={styles.vehiclePlate}>{`  ${v.plate}`}</Text> : null}
                  </Text>
                  <Text style={styles.vehiclePlan} numberOfLines={2}>
                    {v.order
                      ? `${v.order.title} · ${formatInr(v.order.total)}${v.order.kind === 'plan' ? ` · ${v.order.washesUsed}/${v.order.washesTotal} washes` : ''}`
                      : NO_PLAN}
                  </Text>
                </View>
                {v.order ? <Pill label={PHASE_STAFF_LABEL[v.order.phase].toUpperCase()} tone={PHASE_STAFF_TONE[v.order.phase]} /> : null}
              </View>
            ))}
          </View>
        );
      })}

      {notJoined.length ? (
        <View style={styles.waiting}>
          <Text style={styles.cardTitle}>Not joined yet · {notJoined.length}</Text>
          <Text style={styles.cardNote}>Flats on the list with no one signed up. Worth a knock or a QR poster near the lift.</Text>
          <FlatChips units={notJoined} tone="slate" />
        </View>
      ) : null}
    </>
  );
}

/** How many joined, what it earns (and could), which flat took which plan with which vehicles. */
export const plansTab: ReviewTab = {
  key: 'plans',
  label: 'Plans',
  title: 'Who took which plan',
  icon: (c) => <IconTag size={17} color={c} />,
  show: () => true,
  state: (c) => (c.members.some((m) => memberVehicles(m).some((v) => isUnpaid(v.order))) ? 'attention' : c.members.length ? 'done' : 'optional'),
  summary: (c) => {
    if (!c.members.length) return 'No one has joined yet';
    const flats = new Set(c.members.map((m) => m.unit)).size;
    const monthNow = c.members.reduce((n, m) => n + memberVehicles(m).reduce((s, v) => s + monthlyValue(v.order), 0), 0);
    const share = c.units.length ? ` (${pct(flats, c.units.length)}%)` : '';
    return `${plural(flats, 'flat')}${share} · ${formatInr(monthNow)} a month`;
  },
  Body: PlansBody,
};

const styles = StyleSheet.create({
  label: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0.1 },
  empty: { gap: 4, padding: spacing.md, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surface },
  emptyTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  emptyText: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0, lineHeight: 18 },

  cardTitle: { ...typography.label, fontSize: 12, fontWeight: '800', color: TEAL, letterSpacing: 0.6, textTransform: 'uppercase' },
  cardNote: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  interest: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: 18, backgroundColor: TEAL_MIST, borderWidth: 1, borderColor: TEAL_PALE },
  uptake: { gap: 6 },
  uptakeTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  uptakeLabel: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.waterInk },
  uptakeValue: { ...typography.heading, fontSize: 18, letterSpacing: -0.3 },
  uptakePct: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.slateDeep },
  uptakeBar: { height: 8, borderRadius: 4, backgroundColor: colors.white, overflow: 'hidden' },
  uptakeFill: { height: 8, borderRadius: 4 },

  earn: { gap: 6, padding: spacing.md, borderRadius: 18, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  earnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap', marginTop: 4 },
  earnTitle: { ...typography.label, fontSize: 12, fontWeight: '800', color: GREEN, letterSpacing: 0.6, textTransform: 'uppercase' },
  earnSubTitle: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.waterInk },
  rates: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.pill, backgroundColor: colors.white },
  rate: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  rateOn: { backgroundColor: GREEN },
  rateText: { ...typography.caption, fontSize: 12, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0 },
  rateTextOn: { color: colors.white },
  earnValue: { ...typography.display, fontSize: 32, lineHeight: 38, color: GREEN, letterSpacing: -0.8 },
  earnSub: { ...typography.label, fontSize: 13.5, color: colors.waterInk, fontWeight: '700' },
  earnNote: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0, lineHeight: 16, marginTop: 2 },

  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: 14, backgroundColor: colors.surface, gap: 1 },
  statValue: { ...typography.heading, fontSize: 22, letterSpacing: -0.4 },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.slateDeep, letterSpacing: 0, textAlign: 'center' },
  money: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm + 4, borderRadius: 14, backgroundColor: colors.white },
  moneyItem: { flex: 1, gap: 1 },
  moneyRule: { width: 1, alignSelf: 'stretch', backgroundColor: '#BBF7D0', marginHorizontal: spacing.sm },
  moneyLabel: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  moneyValue: { ...typography.heading, fontSize: 19, color: TEAL, letterSpacing: -0.3 },

  plans: { gap: spacing.md, padding: spacing.sm + 4, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  planRow: { gap: 6 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planDot: { width: 10, height: 10, borderRadius: 5 },
  planName: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk, flex: 1 },
  planMoney: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800' },
  planCount: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  planBar: { height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  planFill: { height: 6, borderRadius: 3 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: TEAL_PALE },
  chipSlate: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { ...typography.caption, fontSize: 12, fontWeight: '800', color: TEAL, letterSpacing: 0 },
  chipTextSlate: { color: colors.slateDeep },
  chipMore: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },

  flat: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  flatHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  flatCopy: { flex: 1, gap: 1, minWidth: 0 },
  flatName: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  flatMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  flatMoney: { alignItems: 'flex-end', gap: 1 },
  flatTotal: { ...typography.heading, fontSize: 16, color: TEAL },
  flatPerMonth: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 4 },
  vehicleIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  vehicleCopy: { flex: 1, gap: 1, minWidth: 0 },
  vehicleLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  vehiclePlate: { ...typography.caption, fontSize: 12.5, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0.6 },
  vehiclePlan: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },

  waiting: { gap: spacing.sm, padding: spacing.md, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surface },
});
