import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { brandGradients, colors, spacing, typography } from '../theme';
import { Button } from './Button';
import { Gradient } from './Gradient';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

/** Centred icon, title and line of help for a list with nothing in it (or that failed to load). */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Gradient spec={brandGradients.tileSoft} style={styles.icon}>
        {icon}
      </Gradient>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.heading, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  body: { ...typography.body, color: colors.slateDeep, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  action: { marginTop: spacing.md, alignSelf: 'stretch', maxWidth: 280, width: '100%' },
});
