import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@mana/ui';
import { LANE_META, type Lane } from './lanes';

export interface LaneBadge {
  count: number;
  /** `alert`: needs someone (approvals); `soft`: just a count (cars open). */
  tone: 'alert' | 'soft';
}

/** Glass segmented control in the home hero: one tab per way this branch washes. */
export function LaneTabs({
  lanes,
  value,
  onChange,
  badges,
}: {
  lanes: readonly Lane[];
  value: Lane;
  onChange: (lane: Lane) => void;
  badges?: Partial<Record<Lane, LaneBadge>>;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {lanes.map((lane) => {
        const meta = LANE_META[lane];
        const on = lane === value;
        const badge = badges?.[lane];
        const tint = on ? meta.accent : colors.white;
        return (
          <Pressable
            key={lane}
            onPress={() => onChange(lane)}
            style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${meta.label}${badge && badge.count > 0 ? `, ${badge.count}` : ''}`}
            hitSlop={4}
          >
            <meta.Icon size={16} color={tint} />
            <Text style={[styles.label, on && { color: meta.accent }]} numberOfLines={1}>
              {meta.label}
            </Text>
            {badge && badge.count > 0 ? (
              <View
                style={[
                  styles.badge,
                  badge.tone === 'alert' ? styles.badgeAlert : on ? { backgroundColor: meta.accent } : styles.badgeSoft,
                ]}
              >
                <Text style={styles.badgeText}>{badge.count > 99 ? '99+' : badge.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: spacing.xs,
    borderRadius: 999,
    minWidth: 0,
  },
  tabOn: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  tabPressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  label: {
    ...typography.label,
    fontSize: 13.5,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.92)',
    flexShrink: 1,
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeAlert: { backgroundColor: colors.amber },
  badgeSoft: { backgroundColor: 'rgba(255,255,255,0.24)' },
  badgeText: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
});
