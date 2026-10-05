import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandMark, Gradient, GradientHero, IconMapPin, IconStar, brandGradients, colors, radius } from '@mana/ui';

interface HomeHeroProps {
  /** "Good morning" and so on. */
  greeting: string;
  /** The customer's first name, if we have it. */
  name?: string;
  /** The branch, as "Name, City". */
  branch: string;
  /** Shown as the gold pill when a free wash is ready. */
  freeText?: string;
  onProfile: () => void;
  /** True when a card overlaps the bottom of the hero (the usual case), so it needs room for it. */
  overlap?: boolean;
}

/** The top of Home: the logo and profile avatar, a greeting, the branch, and a gold pill for a free wash. */
export function HomeHero({ greeting, name, branch, freeText, onProfile, overlap = true }: HomeHeroProps) {
  const initial = name?.trim().charAt(0).toUpperCase();
  return (
    <GradientHero>
      <View style={[styles.content, !overlap && styles.contentFlush]}>
        <View style={styles.topRow}>
          <View style={styles.brand} accessible accessibilityLabel="MANA">
            <BrandMark size={26} variant="onDark" />
            <Text style={styles.brandText}>MANA</Text>
          </View>
          <Pressable
            onPress={onProfile}
            style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
            accessibilityRole="button"
            accessibilityLabel="Your profile"
          >
            <Text style={styles.avatarText}>{initial || 'M'}</Text>
          </Pressable>
        </View>

        <View style={styles.hello} accessible accessibilityRole="header">
          {name ? <Text style={styles.small}>{greeting}</Text> : null}
          <Text style={styles.title}>{name ?? greeting}</Text>
        </View>

        <View style={styles.chips}>
          <View style={styles.glass}>
            <IconMapPin size={15} color={colors.white} />
            <Text style={styles.glassText}>{branch}</Text>
          </View>
          {freeText ? (
            <View style={styles.goldShell}>
              <Gradient spec={brandGradients.gold} style={styles.gold}>
                <IconStar size={15} color={colors.goldInk} filled />
                <Text style={styles.goldText}>{freeText}</Text>
              </Gradient>
            </View>
          ) : null}
        </View>
      </View>
    </GradientHero>
  );
}

const styles = StyleSheet.create({
  // The bottom padding leaves room for the first card to overlap the hero by 44.
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 72 },
  contentFlush: { paddingBottom: 28 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: 'rgba(255,255,255,0.95)', fontSize: 12.5, fontWeight: '800', letterSpacing: 2.4 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  avatarText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  hello: { marginTop: 22 },
  small: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '600' },
  title: { color: colors.white, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 9,
    paddingRight: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  glassText: { color: colors.white, fontSize: 13.5, fontWeight: '600' },
  goldShell: {
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  gold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 9,
    paddingRight: 13,
    borderRadius: radius.pill,
  },
  goldText: { color: colors.goldInk, fontSize: 13.5, fontWeight: '800' },
});
