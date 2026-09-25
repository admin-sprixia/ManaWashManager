import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSync } from '../offline/SyncProvider';
import { colors, spacing, typography } from '../theme';
import { IconAlert, IconCloudOff, IconSync } from './Icons';

/**
 * One slim strip under the hero that tells the shift exactly where their data stands:
 * offline (and how many changes are waiting), syncing, or changes that need attention.
 * Hidden entirely when everything is up to date.
 */
export function SyncBanner({ onReview }: { onReview: () => void }) {
  const { online, syncing, pendingCount, failedCount, syncNow } = useSync();

  if (failedCount > 0) {
    return (
      <Pressable onPress={onReview} style={({ pressed }) => [styles.bar, styles.failed, pressed && styles.pressed]}>
        <IconAlert size={16} color={colors.danger} />
        <Text style={[styles.text, styles.failedText]} numberOfLines={1}>
          {failedCount} change{failedCount === 1 ? '' : 's'} couldn’t sync
        </Text>
        <Text style={[styles.action, styles.failedText]}>Review</Text>
      </Pressable>
    );
  }

  if (!online) {
    return (
      <Pressable onPress={() => void syncNow()} style={({ pressed }) => [styles.bar, styles.offline, pressed && styles.pressed]}>
        <IconCloudOff size={16} color={colors.amberDeep} />
        <Text style={[styles.text, styles.offlineText]} numberOfLines={1}>
          {pendingCount > 0
            ? `Offline · ${pendingCount} change${pendingCount === 1 ? '' : 's'} saved on this phone`
            : 'Offline · you can keep working'}
        </Text>
        {syncing ? (
          <ActivityIndicator size="small" color={colors.amberDeep} />
        ) : (
          <Text style={[styles.action, styles.offlineText]}>Retry</Text>
        )}
      </Pressable>
    );
  }

  if (pendingCount > 0) {
    return (
      <View style={[styles.bar, styles.syncing]}>
        <IconSync size={16} color={colors.waterDeep} />
        <Text style={[styles.text, styles.syncingText]} numberOfLines={1}>
          Syncing {pendingCount} change{pendingCount === 1 ? '' : 's'}…
        </Text>
        <ActivityIndicator size="small" color={colors.water} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.85 },
  text: { ...typography.label, flex: 1, textTransform: 'none', fontSize: 13 },
  action: { ...typography.label, fontWeight: '700', fontSize: 13 },
  offline: { backgroundColor: '#FFFBEB', borderBottomColor: colors.amberLight },
  offlineText: { color: colors.amberDeep },
  failed: { backgroundColor: '#FEF2F2', borderBottomColor: '#FECACA' },
  failedText: { color: colors.danger },
  syncing: { backgroundColor: colors.waterPale, borderBottomColor: colors.border },
  syncingText: { color: colors.waterDeep },
});
