import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_PROPOSED_SLOTS, MIN_PROPOSED_SLOTS, sortWeekdays, type ProposedSlot } from '@mana/domain';
import { IconCalendar, IconCheck, IconClose, IconPlus, colors, radius, showAlert, spacing, typography } from '@mana/ui';
import { api } from '../../../api/client';
import { MultiSelectField } from '../../../components/SelectField';
import { TEAL, TEAL_MIST, TEAL_PALE } from '../panel/parts';
import { ChoiceSheet } from './ChoiceSheet';
import { choiceLabel, DAY_SELECT_OPTIONS, daysSummary, scheduleLine, slotLine } from './options';
import { TimeField } from './TimeField';
import type { ReviewContext, ReviewTab } from './types';

function ScheduleBody({ ctx }: { ctx: ReviewContext }) {
  const { days, setDays, time, setTime, live } = ctx.settings;
  const [adding, setAdding] = useState(false);
  const slots: readonly ProposedSlot[] = live ? [] : ctx.place.setup.slots;
  const picked = sortWeekdays(days.map(Number)).join();
  const matches = (s: ProposedSlot) => s.time === time && sortWeekdays(s.days).join() === picked;

  const saveSlots = (next: ProposedSlot[], done: string) =>
    ctx.run(() => api.places[':id'].setup.$patch({ param: { id: ctx.placeId }, json: { slots: next } }), done);

  const remove = (i: number) =>
    showAlert(`Remove the ${choiceLabel(i).toLowerCase()}?`, slotLine(slots[i]!), [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void saveSlots(slots.filter((_, j) => j !== i), 'Choice removed') },
    ]);

  return (
    <>
      {!live ? (
        <View style={styles.suggest}>
          <View style={styles.suggestHead}>
            <Text style={styles.label}>Residents asked for</Text>
            <Text style={[styles.count, slots.length < MIN_PROPOSED_SLOTS && { color: colors.amberDeep }]}>
              {slots.length}/{MAX_PROPOSED_SLOTS}
              {slots.length < MIN_PROPOSED_SLOTS ? ` · ${MIN_PROPOSED_SLOTS} needed` : ''}
            </Text>
          </View>
          {slots.map((s, i) => {
            const on = matches(s);
            return (
              <Pressable
                key={`${i}-${s.time}-${s.days.join()}`}
                onPress={() => {
                  setDays(s.days.map(String));
                  setTime(s.time);
                }}
                style={({ pressed }) => [styles.slot, on && styles.slotOn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Use ${choiceLabel(i)}: ${slotLine(s)}`}
              >
                <View style={[styles.rank, on && styles.rankOn]}>
                  <Text style={[styles.rankText, on && styles.rankTextOn]}>{i + 1}</Text>
                </View>
                <View style={styles.slotCopy}>
                  <Text style={styles.slotRank}>{choiceLabel(i)}</Text>
                  <Text style={styles.slotText}>{slotLine(s)}</Text>
                </View>
                {on ? (
                  <View style={styles.using}>
                    <IconCheck size={11} color={TEAL} />
                    <Text style={styles.usingText}>Using</Text>
                  </View>
                ) : (
                  <Text style={styles.use}>Use this</Text>
                )}
                <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${choiceLabel(i)}`}>
                  <IconClose size={12} color={colors.slate} />
                </Pressable>
              </Pressable>
            );
          })}
          {slots.length < MAX_PROPOSED_SLOTS ? (
            <Pressable onPress={() => setAdding(true)} style={({ pressed }) => [styles.add, pressed && styles.pressed]} accessibilityRole="button">
              <IconPlus size={15} color={TEAL} />
              <Text style={styles.addText}>{slots.length ? `Add ${choiceLabel(slots.length)}` : 'Add what residents asked for'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <MultiSelectField
        label="Wash days"
        value={days}
        options={DAY_SELECT_OPTIONS}
        onChange={setDays}
        min={1}
        round
        summarize={(p) => daysSummary(p.map((x) => x.value))}
        placeholder="Pick the days"
        sheetTitle="Wash days"
        sheetSubtitle="Tap each day the team goes. Weekly plans wash on the first of these."
        icon={<IconCalendar size={17} color={TEAL} />}
        accent={TEAL}
        accentPale={TEAL_PALE}
      />
      <TimeField value={time} onChange={setTime} hint="Between 5:00 AM and 10:00 PM, on the half hour." />

      <ChoiceSheet
        visible={adding}
        title={choiceLabel(slots.length)}
        onClose={() => setAdding(false)}
        onSave={async (slot) => {
          const message = await saveSlots([...slots, slot], `${choiceLabel(slots.length)} added`);
          if (!message) setAdding(false);
          return message;
        }}
      />
    </>
  );
}

export const scheduleTab: ReviewTab = {
  key: 'schedule',
  label: 'Schedule',
  title: 'Wash schedule',
  icon: (c) => <IconCalendar size={18} color={c} />,
  show: () => true,
  state: (c) => (c.settings.days.length ? 'done' : 'needed'),
  summary: (c) => scheduleLine(c.settings.days, c.settings.time),
  Body: ScheduleBody,
};

const styles = StyleSheet.create({
  suggest: { gap: spacing.sm },
  suggestHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0.1 },
  count: { ...typography.label, fontSize: 12.5, fontWeight: '800', color: TEAL },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 4,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.sm,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  slotOn: { borderColor: colors.teal, backgroundColor: TEAL_MIST },
  pressed: { opacity: 0.8 },
  rank: { width: 28, height: 28, borderRadius: 14, backgroundColor: TEAL_PALE, alignItems: 'center', justifyContent: 'center' },
  rankOn: { backgroundColor: colors.teal },
  rankText: { ...typography.label, fontSize: 12.5, fontWeight: '800', color: TEAL },
  rankTextOn: { color: colors.white },
  slotCopy: { flex: 1, gap: 1 },
  slotRank: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  slotText: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  use: { ...typography.label, fontSize: 13, fontWeight: '800', color: TEAL },
  using: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#ECFDF5' },
  usingText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: TEAL, letterSpacing: 0 },
  remove: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#99F6E4',
    backgroundColor: TEAL_MIST,
  },
  addText: { ...typography.label, fontSize: 14, fontWeight: '800', color: TEAL },
});
