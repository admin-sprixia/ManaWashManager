import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Notice, colors, spacing } from '@mana/ui';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import type { Wash } from '../api/types';
import { HAIRLINE, SectionLabel } from '../components/CardList';
import { MessageCard } from '../components/MessageCard';
import { SkeletonList } from '../components/Skeleton';
import { TabTitle } from '../components/TabTitle';
import { WashRow } from '../components/WashRow';
import type { MainStackParams, TabParams } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParams, 'Washes'>,
  NativeStackScreenProps<MainStackParams>
>;

interface WashSection {
  key: string;
  title: string;
  /** "3 washes", "1 in progress". */
  right: string;
  data: Wash[];
}

const PAGE = 20;

const monthTitle = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;

/** Washes still on the board come first as "Today"; the rest are grouped by month, newest first. */
function toSections(washes: Wash[]): WashSection[] {
  const live = washes.filter((w) => w.status !== 'paid');
  const sections: WashSection[] = live.length > 0 ? [{ key: 'today', title: 'Today', right: `${live.length} in progress`, data: live }] : [];
  for (const wash of washes) {
    if (wash.status !== 'paid') continue;
    const title = monthTitle(wash.createdAt);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(wash);
    else sections.push({ key: title, title, right: '', data: [wash] });
  }
  for (const s of sections) if (s.key !== 'today') s.right = count(s.data.length, 'wash');
  return sections;
}

/** Between two rows: a hairline that starts under the text, on the white of the block. */
function Separator() {
  return (
    <View style={styles.separatorWrap}>
      <View style={styles.separator} />
    </View>
  );
}

/** Every wash across the customer's branches, grouped by month, loading more on scroll. */
export function WashesScreen({ navigation }: Props) {
  const [washes, setWashes] = useState<Wash[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const loadFirst = useCallback(async (pull: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (pull) setRefreshing(true);
    try {
      const page = await send(api.washes.$get({ query: { limit: String(PAGE) } }));
      setWashes(page.washes);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busy.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (busy.current || !nextBefore) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await send(api.washes.$get({ query: { limit: String(PAGE), before: nextBefore } }));
      setWashes((current) => {
        const seen = new Set(current.map((w) => w.id));
        return [...current, ...page.washes.filter((w) => !seen.has(w.id))];
      });
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [nextBefore]);

  useEffect(() => {
    void loadFirst(false);
  }, [loadFirst]);

  const sections = useMemo(() => toSections(washes), [washes]);
  // The plate only helps when there is more than one vehicle to tell apart.
  const showPlate = useMemo(() => new Set(washes.map((w) => w.vehicle.registrationNumber)).size > 1, [washes]);

  return (
    <View style={styles.screen}>
      <TabTitle title="My washes" subtitle="Every visit, with its bill and photos." />
      <SectionList<Wash, WashSection>
        sections={sections}
        keyExtractor={(w) => w.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          error && washes.length > 0 ? (
            <View style={styles.pad}>
              <Notice tone="warning">{error}</Notice>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => <SectionLabel right={section.right}>{section.title}</SectionLabel>}
        renderItem={({ item, index, section }) => (
          <View style={[styles.item, index === 0 && styles.first, index === section.data.length - 1 && styles.last]}>
            <WashRow wash={item} showPlate={showPlate} onPress={() => navigation.navigate('WashDetail', { id: item.id })} />
          </View>
        )}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          loading ? (
            <SkeletonList groups={[4, 3]} />
          ) : error ? (
            <MessageCard
              title="Couldn’t load your washes"
              body={error}
              action={{ label: 'Try again', onPress: () => void loadFirst(false) }}
            />
          ) : (
            <MessageCard title="No washes yet" body="Each wash at MANA shows here, with its photos." />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.more}>
              <ActivityIndicator color={colors.indigoBright} />
              <Text style={styles.moreText}>Loading more…</Text>
            </View>
          ) : washes.length > 0 && nextBefore == null ? (
            <Text style={styles.end}>That’s all your washes</Text>
          ) : null
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadFirst(true)} colors={[colors.indigo]} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.lg },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  // A section's rows read as one white block: a hairline above the first row and below the last.
  item: { backgroundColor: colors.white },
  first: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  last: { borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  separatorWrap: { backgroundColor: colors.white },
  separator: { height: 1, marginLeft: 74, backgroundColor: HAIRLINE },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 18 },
  moreText: { fontSize: 13.5, fontWeight: '600', color: colors.slateDeep },
  end: { textAlign: 'center', paddingTop: 18, fontSize: 12.5, fontWeight: '600', color: colors.slate },
});
