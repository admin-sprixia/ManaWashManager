import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { Button } from './Button';

interface PromptModalProps {
  visible: boolean;
  title: string;
  label: string;
  initialValue?: string;
  keyboardType?: 'default' | 'numeric';
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

/**
 * A bottom-sheet prompt — Android has no built-in equivalent to iOS's Alert.prompt, so this
 * is the one custom dialog in the app. Slides up from the bottom (the native Modal
 * "slide" animation), rounded top corners, a drag-handle affordance for the familiar feel.
 */
export function PromptModal({
  visible,
  title,
  label,
  initialValue = '',
  keyboardType = 'default',
  onCancel,
  onSubmit,
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, shadow('lg')]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            keyboardType={keyboardType}
            autoFocus
          />
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button label="Save" onPress={() => onSubmit(value)} disabled={value.trim().length === 0} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 47, 73, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.waterInk,
  },
  label: {
    ...typography.label,
    color: colors.slateDeep,
    textTransform: 'none',
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    fontWeight: '600',
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
