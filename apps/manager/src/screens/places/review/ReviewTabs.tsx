import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IconAlert, IconCheck, IconChevronRight, colors, radius, spacing, typography } from '@mana/ui';
import { TEAL, TEAL_PALE } from '../panel/parts';
import type { ReviewContext, ReviewTab, TabState } from './types';

const STATE: Record<TabState, { label: string; fg: string; bg: string }> = {
  done: { label: 'Done', fg: TEAL, bg: '#ECFDF5' },
  attention: { label: 'Check', fg: colors.amberDeep, bg: '#FFFBEB' },
  needed: { label: 'Needed', fg: colors.danger, bg: '#FEF2F2' },
  optional: { label: 'Recommended', fg: colors.slateDeep, bg: '#F1F5F9' },
};

const DOT: Record<TabState, string> = { done: colors.teal, attention: colors.amber, needed: colors.danger, optional: '#CBD5E1' };

/** The tab bar: an icon, a short name and a status dot per part. */
export function ReviewTabBar({ tabs, active, onChange, ctx }: { tabs: ReviewTab[]; active: string; onChange: (key: string) => void; ctx: ReviewContext }) {
  // Up to five share the width; more scroll sideways so labels stay readable.
  const scrolls = tabs.length > 5;
  const items = tabs.map((t) => {
    const on = t.key === active;
    const state = t.state(ctx);
    return (
      <Pressable
        key={t.key}
        onPress={() => onChange(t.key)}
        style={({ pressed }) => [styles.tab, scrolls && styles.tabFixed, on && styles.tabOn, pressed && !on && styles.tabPressed]}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${t.label}, ${STATE[state].label}`}
      >
        <View style={[styles.tabIcon, on && styles.tabIconOn]}>
          {t.icon(on ? colors.white : TEAL)}
          <View style={[styles.dot, { backgroundColor: DOT[state] }]} />
        </View>
        <Text style={[styles.tabLabel, on && styles.tabLabelOn]} numberOfLines={1}>
          {t.label}
        </Text>
      </Pressable>
    );
  });
  return (
    <View style={styles.barWrap}>
      {scrolls ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.barScroll} accessibilityRole="tablist">
          {items}
        </ScrollView>
      ) : (
        <View style={[styles.bar, styles.barRow]} accessibilityRole="tablist">
          {items}
        </View>
      )}
    </View>
  );
}

/** The open tab: its heading, what's chosen, its status, the fields, and a step to the next tab. */
export function ReviewTabPanel({ tab, ctx, next, onNext }: { tab: ReviewTab; ctx: ReviewContext; next?: ReviewTab; onNext?: () => void }) {
  const state = STATE[tab.state(ctx)];
  const Body = tab.Body;
  const kind = tab.state(ctx);
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Text style={styles.title}>{tab.title}</Text>
          <Text style={styles.summary} numberOfLines={2}>
            {tab.summary(ctx)}
          </Text>
        </View>
        <View style={[styles.state, { backgroundColor: state.bg }]}>
          {kind === 'done' ? <IconCheck size={11} color={state.fg} /> : kind === 'attention' || kind === 'needed' ? <IconAlert size={11} color={state.fg} /> : null}
          <Text style={[styles.stateText, { color: state.fg }]}>{state.label}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Body ctx={ctx} />
      </View>
      {next && onNext ? (
        <Pressable onPress={onNext} style={({ pressed }) => [styles.next, pressed && styles.tabPressed]} accessibilityRole="button">
          <Text style={styles.nextText}>Next: {next.label}</Text>
          <IconChevronRight size={16} color={TEAL} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  barWrap: { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  bar: {
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#062B28',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  barRow: { flexDirection: 'row', gap: 4, padding: 4 },
  barScroll: { flexDirection: 'row', gap: 4, padding: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.sm, borderRadius: 16, minWidth: 0 },
  tabFixed: { flex: 0, width: 70 },
  tabOn: { backgroundColor: '#F0FDFA' },
  tabPressed: { opacity: 0.75 },
  tabIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: TEAL_PALE, alignItems: 'center', justifyContent: 'center' },
  tabIconOn: { backgroundColor: TEAL },
  dot: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.white },
  tabLabel: { ...typography.caption, fontSize: 12, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0 },
  tabLabelOn: { color: TEAL, fontWeight: '800' },

  panel: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headCopy: { flex: 1, gap: 3 },
  title: { ...typography.heading, fontSize: 18, color: colors.ink, letterSpacing: -0.3 },
  summary: { ...typography.label, fontSize: 13.5, color: colors.slateDeep, lineHeight: 18 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  stateText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  body: { padding: spacing.md, gap: spacing.md },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: '#F0FDFA',
  },
  nextText: { ...typography.label, fontSize: 14, fontWeight: '800', color: TEAL },
});
