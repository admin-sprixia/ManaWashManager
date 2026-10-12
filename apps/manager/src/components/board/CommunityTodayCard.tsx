import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { InferResponseType } from 'hono/client';
import { formatClock } from '@mana/domain';
import { IconBuilding, IconChevronRight, colors, radius, spacing, typography } from '@mana/ui';
import { api } from '../../api/client';

type Overview = InferResponseType<(typeof api)['places']['overview']['$get'], 200>;

/**
 * Today's community washes for the home screen, refreshed whenever the board comes into view.
 * Failures stay quiet: the board works offline and this is extra.
 */
export function useCommunityToday() {
  const [data, setData] = useState<Overview | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.places.overview
        .$get({ query: { days: '1' } })
        .then(async (res) => {
          if (res.ok && alive) setData(await res.json());
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  return { places: data?.days[0]?.places ?? [], review: data?.review ?? 0 };
}

/** "Communities today: Lakshmi Towers 4 of 9 washed" — only on days the team goes out. */
export function CommunityTodayCard({ places, onPress }: { places: ReturnType<typeof useCommunityToday>['places']; onPress: () => void }) {
  if (!places.length) return null;
  const due = places.reduce((n, p) => n + p.due, 0);
  const done = places.reduce((n, p) => n + p.done, 0);
  const far = places.reduce((n, p) => n + p.far, 0);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Community washes today: ${done} of ${due} washed`}>
      <View style={styles.icon}>
        <IconBuilding size={20} color={colors.waterDeep} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>
          Communities today · {done} of {due} washed
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {places.map((p) => `${p.title} ${formatClock(p.washTime)}${p.due ? ` (${p.done}/${p.due})` : ''}`).join(' · ')}
        </Text>
        {far ? <Text style={styles.warn}>{far} recorded away from the community</Text> : null}
      </View>
      <IconChevronRight size={18} color={colors.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
  },
  pressed: { opacity: 0.75 },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.waterPale, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  sub: { fontSize: 13, color: colors.slateDeep },
  warn: { ...typography.caption, color: colors.amberDeep, fontWeight: '700' },
});
