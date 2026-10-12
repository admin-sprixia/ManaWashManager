import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  IconChevronRight,
  IconPhone,
  IconUserPlus,
  Gradient,
  brandGradients,
  colors,
  radius,
  shadow,
} from '@mana/ui';

interface InvitePromoProps {
  /** What the friend gets, e.g. "5–10% off". */
  offer: string;
  onPress: () => void;
}

/** The invite-a-friend card: a white card like the rest, with an indigo button. */
export function InvitePromo({ offer, onPress }: InvitePromoProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.tile}>
          <IconUserPlus size={22} color={colors.tealDeep} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header">
            Invite a friend
          </Text>
          <Text style={styles.body}>They get {offer} their first wash, and so do you.</Text>
        </View>
      </View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        accessibilityLabel="Share your invite"
      >
        <Text style={styles.ctaText}>Share your invite</Text>
        <IconChevronRight size={15} color={colors.white} />
      </Pressable>
    </View>
  );
}

interface HelpCardProps {
  onPress: () => void;
}

/** Help & support as a card row. */
export function HelpCard({ onPress }: HelpCardProps) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.help, pressed && styles.helpPressed]}
      accessibilityRole="button"
      accessibilityLabel="Help and support. Call the branch or report a problem"
    >
      <Gradient spec={brandGradients.tile} style={styles.helpTile}>
        <IconPhone size={22} color={colors.indigo} />
      </Gradient>
      <View style={styles.copy}>
        <Text style={styles.helpTitle}>Help & support</Text>
        <Text style={styles.helpMeta}>Call the branch or report a problem</Text>
      </View>
      <View style={styles.chevron}>
        <IconChevronRight size={16} color={colors.slate} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    padding: 16,
    gap: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealPale,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  body: { fontSize: 13.5, lineHeight: 19, color: colors.slateDeep, marginTop: 2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.indigoMid,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.white },
  help: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  helpPressed: { backgroundColor: colors.surface },
  helpTile: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.14)',
  },
  helpTitle: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  helpMeta: { fontSize: 13.5, color: colors.slateDeep, marginTop: 1 },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
