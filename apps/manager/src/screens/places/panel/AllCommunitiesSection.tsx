import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { describeWashDays, formatClock, type PlaceStatus } from '@mana/domain';
import { IconChevronRight, IconPlus, IconSearch, IconUsers, Pill, colors, radius, spacing, typography } from '@mana/ui';
import { BoardSectionHeader } from '../../../components/board/BoardSectionHeader';
import { placeTitle, type PlaceListItem } from '../shared';
import { Chip, PanelRow, PlaceTile, QuietRow, TEAL, plural } from './parts';
import type { Nav } from './types';

const FILTERS: { key: PlaceStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'closed', label: 'Closed' },
];

/** Every live community: what day and time, how many people, and what needs chasing. */
export function AllCommunitiesSection({ live, nav }: { live: PlaceListItem[]; nav: Nav }) {
  const [filter, setFilter] = useState<PlaceStatus>('active');
  const [search, setSearch] = useState('');
  const counts = useMemo(
    () => ({
      active: live.filter((p) => p.status === 'active').length,
      paused: live.filter((p) => p.status === 'paused').length,
      closed: live.filter((p) => p.status === 'closed').length,
    }),
    [live],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.filter((p) => p.status === filter && (!q || `${p.name ?? ''} ${p.label}`.toLowerCase().includes(q)));
  }, [live, filter, search]);
  const showFilters = counts.paused + counts.closed > 0;

  return (
    <View>
      <BoardSectionHeader title="Your communities" count={counts.active || undefined} />

      {showFilters || live.length > 4 ? (
        <View style={styles.tools}>
          {live.length > 4 ? (
            <View style={styles.searchWrap}>
              <IconSearch size={17} color={colors.slate} />
              <TextInput
                style={styles.search}
                value={search}
                onChangeText={setSearch}
                placeholder="Search by name"
                placeholderTextColor={colors.slate}
                accessibilityLabel="Search communities"
                disableFullscreenUI
              />
            </View>
          ) : null}
          {showFilters ? (
            <View style={styles.filters} accessibilityRole="tablist">
              {FILTERS.filter((f) => f.key === 'active' || counts[f.key] > 0).map((f) => {
                const on = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.filter, on && styles.filterOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.filterText, on && styles.filterTextOn]}>
                      {f.label} {counts[f.key]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {shown.map((p, i) => {
        const muted = p.status !== 'active';
        const chips = [
          <Chip key="m" label={plural(p.members, 'member')} tone="teal" icon={<IconUsers size={11} color={TEAL} />} />,
          p.unpaid ? <Chip key="u" label={`${p.unpaid} not paid`} tone="danger" /> : null,
          p.waitlist ? <Chip key="w" label={`${p.waitlist} waiting`} tone="slate" /> : null,
        ];
        return (
          <PanelRow
            key={p.id}
            first={i === 0}
            muted={muted}
            leading={<PlaceTile name={placeTitle(p)} muted={muted} />}
            title={placeTitle(p)}
            meta={`${describeWashDays(p.washDays)} · ${formatClock(p.washTime)}`}
            right={
              p.pending > 0 ? (
                <Pill label={`${p.pending} TO CONFIRM`} tone="danger" />
              ) : muted ? (
                <Pill label={p.status === 'paused' ? 'PAUSED' : 'CLOSED'} tone="slate" />
              ) : (
                <IconChevronRight size={18} color={colors.slate} />
              )
            }
            footer={<>{chips}</>}
            onPress={() => nav.navigate('Place', { placeId: p.id })}
          />
        );
      })}

      {!shown.length ? (
        <QuietRow
          first
          title={search ? 'No community by that name' : filter === 'active' ? 'No live communities yet' : `Nothing ${filter}`}
          body={search ? 'Try another name.' : filter === 'active' ? 'Visit a building or colony, add it, and send it for approval.' : undefined}
        />
      ) : null}

      <Pressable
        onPress={() => nav.navigate('CommunitySetup')}
        android_ripple={{ color: '#F0FDFA' }}
        style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        accessibilityRole="button"
        accessibilityLabel="Add a community"
      >
        <View style={styles.addIcon}>
          <IconPlus size={18} color={colors.white} />
        </View>
        <View style={styles.addCopy}>
          <Text style={styles.addTitle}>Add a community</Text>
          <Text style={styles.addMeta}>After visiting: gate pin, photos, what you found</Text>
        </View>
        <IconChevronRight size={18} color={colors.slate} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tools: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  search: { flex: 1, paddingVertical: 9, ...typography.body, fontSize: 15, color: colors.waterInk },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  filterOn: { backgroundColor: TEAL, borderColor: TEAL },
  filterText: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700' },
  filterTextOn: { color: colors.white },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  addPressed: { backgroundColor: colors.surface },
  addIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  addCopy: { flex: 1, gap: 2 },
  addTitle: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: TEAL },
  addMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
});
