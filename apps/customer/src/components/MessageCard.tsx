import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrandMark, Button, Gradient, brandGradients, colors, radius, shadow } from '@mana/ui';

interface MessageCardProps {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  /** Overlap the hero (when this is the first card on the screen). */
  overlap?: boolean;
}

/** A card with the brand mark, a title and a line of help — for "no washes yet" and "couldn't load". */
export function MessageCard({ title, body, action, overlap }: MessageCardProps) {
  return (
    <View style={[styles.card, overlap && styles.overlap]}>
      <Gradient spec={brandGradients.tileSoft} style={styles.mark}>
        <BrandMark size={56} variant="glass" />
      </Gradient>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    alignItems: 'center',
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 24,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  overlap: { marginTop: -44 },
  mark: {
    width: 84,
    height: 84,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.16)',
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 4 },
  body: { fontSize: 14.5, lineHeight: 21, color: colors.slateDeep, textAlign: 'center' },
  action: { marginTop: 16, alignSelf: 'stretch' },
});
