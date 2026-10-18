import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_PLACE_TEAM, USER_ROLE_LABEL, type UserRole } from '@mana/domain';
import { IconAlert, IconCheck, IconUsers, colors, radius, spacing, typography } from '@mana/ui';
import { MultiSelectField } from '../../../components/SelectField';
import { TEAL, TEAL_PALE } from '../panel/parts';
import { CARS_PER_WASHER, teamInsights } from './teamInsights';
import type { ReviewContext, ReviewTab } from './types';

const teamNames = (c: ReviewContext) => c.users.filter((u) => c.settings.teamIds.includes(u.id)).map((u) => u.name);

/** Can the picked washers get through a wash day? A meter of what they can do against what's expected. */
function Capacity({ ctx }: { ctx: ReviewContext }) {
  const i = teamInsights(ctx);
  if (!i.washers) return null;
  const ok = !i.short;
  const fg = ok ? TEAL : colors.amberDeep;
  const pct = i.expected ? Math.min(1, i.canWash / i.expected) : 1;
  return (
    <View style={[styles.capacity, ok ? styles.capacityOk : styles.capacityShort]}>
      <View style={styles.capacityHead}>
        {ok ? <IconCheck size={15} color={fg} /> : <IconAlert size={15} color={fg} />}
        <Text style={[styles.capacityTitle, { color: fg }]}>{ok ? 'Enough washers' : 'Not enough washers'}</Text>
      </View>
      <View style={styles.numbers}>
        <View style={styles.number}>
          <Text style={[styles.numberValue, { color: fg }]}>{i.canWash}</Text>
          <Text style={styles.numberLabel}>
            {i.washers} washer{i.washers === 1 ? '' : 's'} can do a morning
          </Text>
        </View>
        <View style={styles.vs} />
        <View style={styles.number}>
          <Text style={styles.numberValue}>{i.expected ?? '—'}</Text>
          <Text style={styles.numberLabel}>{i.expected == null ? 'Vehicle count not filled in' : 'vehicles expected a wash day'}</Text>
        </View>
      </View>
      {i.expected != null ? (
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: ok ? colors.teal : colors.amber }]} />
        </View>
      ) : null}
      <Text style={styles.capacityHint}>
        {ok
          ? `About ${CARS_PER_WASHER} cars each in a morning. Bikes count as half.`
          : 'Add washers, or set a daily limit under Joining so new members start on the next wash day with room.'}
      </Text>
    </View>
  );
}

function Clashes({ ctx }: { ctx: ReviewContext }) {
  const { lines } = teamInsights(ctx);
  if (!lines.length) return null;
  return (
    <View style={styles.clashes}>
      <View style={styles.capacityHead}>
        <IconAlert size={15} color={colors.amberDeep} />
        <Text style={[styles.capacityTitle, { color: colors.amberDeep }]}>Booked elsewhere at the same time</Text>
      </View>
      {lines.map((l) => (
        <Text key={l} style={styles.clashLine}>
          • {l}
        </Text>
      ))}
      <Text style={styles.capacityHint}>Pick someone else, or move this community’s time by two hours or more.</Text>
    </View>
  );
}

function TeamBody({ ctx }: { ctx: ReviewContext }) {
  const { users, teamError } = ctx;
  const { teamIds, setTeamIds } = ctx.settings;
  const options = useMemo(() => users.map((u) => ({ value: u.id, label: u.name, hint: USER_ROLE_LABEL[u.role as UserRole] ?? u.role })), [users]);

  if (!users.length) return <Text style={styles.help}>{teamError ?? 'Loading the team…'}</Text>;
  return (
    <>
      <MultiSelectField
        label="Who washes here"
        value={teamIds}
        options={options}
        onChange={setTeamIds}
        max={MAX_PLACE_TEAM}
        searchable={users.length > 8}
        summarize={(picked) =>
          picked.length > 3 ? `${picked.slice(0, 3).map((p) => p.label.split(' ')[0]).join(', ')} +${picked.length - 3}` : picked.map((p) => p.label).join(', ')
        }
        placeholder="Pick the washers"
        sheetTitle="Who washes here"
        sheetSubtitle="They see this community on their wash days."
        icon={<IconUsers size={17} color={TEAL} />}
        accent={TEAL}
        accentPale={TEAL_PALE}
        hint="Anyone on the team can still record washes here."
      />
      <Capacity ctx={ctx} />
      <Clashes ctx={ctx} />
    </>
  );
}

export const teamTab: ReviewTab = {
  key: 'team',
  label: 'Team',
  title: 'Team',
  icon: (c) => <IconUsers size={18} color={c} />,
  show: () => true,
  state: (c) => {
    if (!c.settings.teamIds.length) return 'optional';
    const i = teamInsights(c);
    return i.short || i.clashes.length ? 'attention' : 'done';
  },
  summary: (c) => {
    const names = teamNames(c);
    if (!names.length) return 'Nobody picked yet';
    const i = teamInsights(c);
    const note = i.clashes.length ? ` · ${i.clashes.length} clash${i.clashes.length === 1 ? '' : 'es'}` : i.short ? ' · not enough washers' : '';
    return `${names.join(', ')}${note}`;
  },
  Body: TeamBody,
};

const styles = StyleSheet.create({
  help: { ...typography.caption, fontSize: 13, color: colors.slate, letterSpacing: 0 },
  capacity: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: 16, borderWidth: 1 },
  capacityOk: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  capacityShort: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  capacityHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  capacityTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800' },
  numbers: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  number: { flex: 1, gap: 1 },
  vs: { width: 1, backgroundColor: 'rgba(15,23,42,0.1)' },
  numberValue: { ...typography.display, fontSize: 28, lineHeight: 32, color: colors.waterInk, letterSpacing: -0.6 },
  numberLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 16 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(15,23,42,0.08)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  capacityHint: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  clashes: { gap: 6, padding: spacing.sm + 4, borderRadius: 16, borderWidth: 1, borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
  clashLine: { ...typography.label, fontSize: 13.5, fontWeight: '700', color: colors.waterInk, borderRadius: radius.sm },
});
