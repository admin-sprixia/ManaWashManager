import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GradientHero,
  IconBell,
  IconChart,
  IconChevronDown,
  IconGrid,
  IconStore,
  colors,
  gradients,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { formatRupees } from '../../utils/format';

export interface BoardStats {
  cars: number;
  revenue: number;
  open: number;
}

interface HeaderActionsProps {
  isOwner: boolean;
  onReports: () => void;
  onMore: () => void;
  onReminders: () => void;
  /** Vehicles nobody has followed up on yet — shown as a badge on the bell. */
  reminderCount: number;
  /** What in More needs a look (e.g. "stock running low") — a dot on its button, read out by screen readers. */
  moreAlert?: string;
  compact?: boolean;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function washesLabel(n: number): string {
  return `${n} ${n === 1 ? 'wash' : 'washes'}`;
}

function HeaderActions({
  isOwner,
  onReports,
  onMore,
  onReminders,
  reminderCount,
  moreAlert,
  compact,
}: HeaderActionsProps) {
  const size = compact ? 38 : 42;
  const btn = [styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }];
  return (
    <View style={styles.actions}>
      <Pressable
        onPress={onReminders}
        style={({ pressed }) => [btn, pressed && styles.iconBtnPressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          reminderCount > 0 ? `Reminders, ${reminderCount} to follow up` : 'Reminders'
        }
      >
        <IconBell size={19} color={colors.white} />
        {reminderCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{reminderCount > 99 ? '99+' : reminderCount}</Text>
          </View>
        ) : null}
      </Pressable>
      {isOwner ? (
        <Pressable
          onPress={onReports}
          style={({ pressed }) => [btn, pressed && styles.iconBtnPressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Reports"
        >
          <IconChart size={18} color={colors.white} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onMore}
        style={({ pressed }) => [btn, pressed && styles.iconBtnPressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={moreAlert ? `More, ${moreAlert}` : 'More'}
      >
        <IconGrid size={18} color={colors.white} />
        {moreAlert ? <View style={styles.dot} /> : null}
      </Pressable>
    </View>
  );
}

interface BoardHeroProps extends HeaderActionsProps {
  name: string;
  stats: BoardStats;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** Owners with several branches: which shop the board shows, tap to switch. */
  shopSwitch?: { name: string; onPress: () => void };
  /** Shown in the same spot, not tappable, when there's only one shop. */
  shopName?: string;
}

/** Large greeting + today's numbers. Scrolls away with the list; `BoardCompactBar` takes over. */
export function BoardHero({ name, stats, onLayout, shopSwitch, shopName, ...actions }: BoardHeroProps) {
  const { isOwner } = actions;
  const figures = isOwner
    ? [
        { label: 'Washes', value: String(stats.cars) },
        { label: 'Revenue', value: formatRupees(stats.revenue) },
        { label: 'In shop', value: String(stats.open) },
      ]
    : [
        { label: 'Washes', value: String(stats.cars) },
        { label: 'In shop', value: String(stats.open) },
      ];

  return (
    <View onLayout={onLayout}>
      <GradientHero>
        <View style={styles.heroContent}>
          <View style={styles.topRow}>
            {shopSwitch ? (
              <Pressable
                onPress={shopSwitch.onPress}
                style={({ pressed }) => [styles.shopPill, pressed && styles.shopPillPressed]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Shop: ${shopSwitch.name}. Tap to switch shop`}
              >
                <IconStore size={14} color={colors.white} />
                <Text style={styles.shopText} numberOfLines={1}>
                  {shopSwitch.name}
                </Text>
                <IconChevronDown size={14} color={colors.white} />
              </Pressable>
            ) : shopName ? (
              <View style={styles.shopPlain} accessible accessibilityLabel={`Shop: ${shopName}`}>
                <IconStore size={14} color={colors.white} />
                <Text style={styles.shopText} numberOfLines={1}>
                  {shopName}
                </Text>
              </View>
            ) : (
              <View style={styles.flex} />
            )}
            <HeaderActions {...actions} />
          </View>

          <View>
            <Text style={styles.lead}>
              {name ? `${greeting()},` : greeting()}
              {!isOwner ? <Text style={styles.leadRole}> · STAFF</Text> : null}
            </Text>
            {name ? (
              <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {name}
              </Text>
            ) : null}
          </View>

          <View style={styles.split} accessibilityRole="summary">
            {figures.map((f, i) => (
              <View
                key={f.label}
                style={[styles.figure, i > 0 && styles.figureDivided]}
                accessible
                accessibilityLabel={`${f.label}: ${f.value}`}
              >
                <Text style={styles.figureLabel}>{f.label}</Text>
                <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {f.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </GradientHero>
    </View>
  );
}

interface BoardCompactBarProps extends HeaderActionsProps {
  visible: boolean;
  stats: BoardStats;
}

/** Slim pinned bar that fades in once the hero has scrolled off — like an iOS large title collapsing. */
export function BoardCompactBar({ visible, stats, ...actions }: BoardCompactBarProps) {
  const { isOwner } = actions;
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  const summary = isOwner
    ? `${washesLabel(stats.cars)} · ${formatRupees(stats.revenue)}`
    : `${washesLabel(stats.cars)} · ${stats.open} in shop`;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.compactWrap, { opacity }]}
    >
      <LinearGradient
        colors={gradients.hero as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.compact, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.compactCopy}>
          <Text style={styles.compactTitle}>Today</Text>
          <Text style={styles.compactSub} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <HeaderActions {...actions} compact />
      </LinearGradient>
    </Animated.View>
  );
}

const textShadow = {
  textShadowColor: 'rgba(8,47,73,0.28)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
};

const styles = StyleSheet.create({
  heroContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md + 4,
    gap: spacing.md + 4,
  },
  flex: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  shopPillPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  shopPlain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  shopText: {
    ...typography.label,
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    flexShrink: 1,
    ...textShadow,
  },
  lead: {
    ...typography.body,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 16,
    fontWeight: '600',
    ...textShadow,
  },
  leadRole: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.8)' },
  name: {
    ...typography.title,
    color: colors.white,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    ...textShadow,
  },
  actions: { flexDirection: 'row', gap: 10, marginLeft: 'auto' },
  iconBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.amber,
    borderWidth: 2,
    borderColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  dot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.water,
  },
  split: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.45)',
  },
  figure: { flex: 1, gap: 2 },
  figureDivided: {
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.45)',
  },
  figureLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    color: 'rgba(255,255,255,0.85)',
  },
  figureValue: {
    ...typography.heading,
    fontSize: 21,
    color: colors.white,
    ...textShadow,
  },
  compactWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
    gap: spacing.md,
    shadowColor: colors.waterMidnight,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  compactCopy: { flex: 1 },
  compactTitle: { ...typography.heading, color: colors.white, fontSize: 19, letterSpacing: -0.3 },
  compactSub: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0,
    fontSize: 13,
  },
});
