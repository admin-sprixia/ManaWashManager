import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { IconChevronRight, IconPhone, IconUserPlus, Gradient, brandGradients, colors, radius, shadow } from '@mana/ui';

/** Two translucent drops in the corner of the promo card. */
function Drops() {
  return (
    <View style={styles.drops} pointerEvents="none">
      <Svg width={150} height={150} viewBox="0 0 150 150">
        <Path d="M105 26 C105 26 72 62 72 86 A33 33 0 0 0 138 86 C138 62 105 26 105 26Z" fill="#FFFFFF" fillOpacity={0.1} />
        <Path d="M52 78 C52 78 34 98 34 112 A18 18 0 0 0 70 112 C70 98 52 78 52 78Z" fill="#FFFFFF" fillOpacity={0.14} />
      </Svg>
    </View>
  );
}

interface InvitePromoProps {
  /** What the friend gets, e.g. "5–10% off". */
  offer: string;
  onPress: () => void;
}

/** The invite-a-friend card: a gradient promo with a white button. */
export function InvitePromo({ offer, onPress }: InvitePromoProps) {
  return (
    <View style={styles.shell}>
      <Gradient spec={brandGradients.promo} style={styles.promo}>
        <Drops />
        <View style={styles.row}>
          <View style={styles.tile}>
            <IconUserPlus size={24} color={colors.white} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title} accessibilityRole="header">
              Invite a friend
            </Text>
            <Text style={styles.body}>They get {offer} their first wash, and so do you.</Text>
            <Pressable
              onPress={onPress}
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel="Share your invite"
            >
              <Text style={styles.ctaText}>Share your invite</Text>
              <IconChevronRight size={15} color={colors.indigoMid} />
            </Pressable>
          </View>
        </View>
      </Gradient>
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
  shell: {
    marginHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.indigoMid,
    shadowColor: colors.indigoMid,
    shadowOpacity: 0.32,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  promo: { overflow: 'hidden', borderRadius: 22, padding: 18 },
  drops: { position: 'absolute', right: -14, bottom: -18, opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.white },
  body: { fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.86)', marginTop: 3, maxWidth: 250 },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    shadowColor: colors.night,
    shadowOpacity: 0.25,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  ctaPressed: { backgroundColor: colors.indigoPale },
  ctaText: { fontSize: 14, fontWeight: '800', color: colors.indigoMid },
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
  chevron: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
