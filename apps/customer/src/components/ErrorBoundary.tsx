import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, IconAlert, colors, spacing, typography } from '@mana/ui';

interface State {
  failed: boolean;
}

/** A screen that throws while drawing shows a way back instead of a blank white app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.badge}>
          <IconAlert size={30} color={colors.waterDeep} />
        </View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>This screen hit a problem and was closed. Try again.</Text>
        <View style={styles.action}>
          <Button label="Try again" size="lg" onPress={() => this.setState({ failed: false })} />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.white },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  title: { ...typography.heading, color: colors.waterInk, textAlign: 'center' },
  body: { ...typography.body, color: colors.slateDeep, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  action: { alignSelf: 'stretch', marginTop: spacing.lg },
});
