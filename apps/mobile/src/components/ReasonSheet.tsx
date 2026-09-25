import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MIN_REASON_LENGTH } from '@mana/domain';
import { colors, radius, spacing, typography } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { IconCheck } from './Icons';

interface ReasonSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  confirmLabel: string;
  quickReasons: string[];
  onClose: () => void;
  /** Resolve with an error message to keep the sheet open, or null when done. */
  onConfirm: (reason: string) => Promise<string | null>;
}

/**
 * Destructive actions (void a job, void an expense) always ask why. One-tap common reasons
 * keep it fast; the free-text field covers everything else. The reason lands in the audit log.
 */
export function ReasonSheet({
  visible,
  title,
  subtitle,
  confirmLabel,
  quickReasons,
  onClose,
  onConfirm,
}: ReasonSheetProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onConfirm(reason.trim());
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      subtitle={subtitle}
      footer={
        <Button
          label={confirmLabel}
          variant="danger"
          size="lg"
          loading={busy}
          disabled={reason.trim().length < MIN_REASON_LENGTH}
          onPress={() => void confirm()}
        />
      }
    >
      <View style={styles.quickList}>
        {quickReasons.map((q, i) => {
          const on = reason === q;
          return (
            <Pressable
              key={q}
              onPress={() => setReason(q)}
              style={({ pressed }) => [
                styles.quickRow,
                i < quickReasons.length - 1 && styles.divider,
                pressed && styles.pressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <IconCheck size={12} color={colors.white} /> : null}
              </View>
              <Text style={[styles.quickText, on && styles.quickTextOn]}>{q}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.inputBlock}>
        <Text style={styles.inputLabel}>Or write a reason</Text>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={setReason}
          placeholder="What happened?"
          placeholderTextColor={colors.slate}
          maxLength={200}
          multiline
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  quickList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.waterLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  quickText: { ...typography.body, color: colors.waterInk, fontSize: 15 },
  quickTextOn: { fontWeight: '600' },
  inputBlock: { gap: 6 },
  inputLabel: { ...typography.caption, color: colors.slateDeep },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    minHeight: 56,
    color: colors.waterInk,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
