import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthHero, colors, radius, spacing } from '@mana/ui';
import { useIsTablet } from '../layout/Layout';

type HeroProps = Omit<React.ComponentProps<typeof AuthHero>, 'product' | 'maxWidth'>;

const FORM_MAX = 520;

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
  const tablet = useIsTablet();
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.flex}
        refreshControl={refreshControl}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero
          product="Car Wash"
          {...hero}
          maxWidth={tablet ? FORM_MAX + spacing.lg * 2 : undefined}
        />
        <View style={styles.sheet}>
          <View style={tablet ? styles.formTablet : styles.form}>{children}</View>
        </View>
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
  },
  form: { gap: spacing.md },
  // On tablets the form keeps a phone-like width in the middle of the sheet.
  formTablet: { gap: spacing.md, width: '100%', maxWidth: FORM_MAX, alignSelf: 'center' },
});
