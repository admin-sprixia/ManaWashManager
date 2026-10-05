import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthHero, colors, radius, spacing } from '@mana/ui';

type HeroProps = Omit<React.ComponentProps<typeof AuthHero>, 'product'>;

/** Water-gradient hero with a white sheet sliding over it: the signed-out screens. */
export function HeroSheet({
  hero,
  children,
  refreshControl,
}: {
  hero: HeroProps;
  children: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.flex}
        refreshControl={refreshControl}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero product="Car Wash" {...hero} />
        <View style={styles.sheet}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  scroll: { flexGrow: 1 },
  sheet: {
    flex: 1,
    marginTop: -radius.xl,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + 4,
    gap: spacing.md,
  },
});
