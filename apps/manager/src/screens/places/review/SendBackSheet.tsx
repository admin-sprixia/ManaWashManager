import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { REVIEW_NOTE_MAX } from '@mana/domain';
import { BottomSheet, Button, IconCheck, IconEdit, TextField, colors, radius, spacing, typography } from '@mana/ui';
import { api, type ApiResponse } from '../../../api/client';
import { SheetHead, SheetLabel } from '../../../components/SheetBits';

/** What owners send drafts back for most often; one tap adds it to the note. */
const REASONS = [
  'Get the society’s permission in writing',
  'Add a photo of the water point',
  'Add a photo of the parking',
  'Add a photo of the gate',
  'Check the secretary’s number',
  'Ask more residents for the days and time',
  'Count the cars and bikes again',
] as const;

/** The owner's note back to the team: what to fix before it can go live. */
export function SendBackSheet({
  visible,
  placeId,
  onClose,
  onSent,
  run,
}: {
  visible: boolean;
  placeId: string;
  onClose: () => void;
  onSent: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);


  const lines = note.split('\n').map((l) => l.replace(/^•\s*/, '').trim());
  const toggleReason = (r: string) => {
    setError(null);
    setNote((n) => {
      const all = n.split('\n').filter((l) => l.trim());
      const has = all.some((l) => l.replace(/^•\s*/, '').trim() === r);
      const next = has ? all.filter((l) => l.replace(/^•\s*/, '').trim() !== r) : [...all, `• ${r}`];
      return next.join('\n');
    });
  };

  const send = async () => {
    if (note.trim().length < 3) return setError('Say what needs fixing.');
    setBusy(true);
    const message = await run(() => api.places[':id']['send-back'].$post({ param: { id: placeId }, json: { note: note.trim() } }), 'Sent back');
    setBusy(false);
    if (message) return setError(message);
    onSent();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Send back"
      footer={<Button label="Send back to the team" loading={busy} onPress={() => void send()} />}
    >
      <View style={styles.body}>
        <SheetHead
          tone="amber"
          icon={<IconEdit size={20} color={colors.amberDeep} />}
          title="What should the team fix?"
          caption="They see your note on the draft and can send it again."
        />
        <SheetLabel>Quick reasons</SheetLabel>
        <View style={styles.reasons}>
          {REASONS.map((r) => {
            const on = lines.includes(r);
            return (
              <Pressable
                key={r}
                onPress={() => toggleReason(r)}
                style={({ pressed }) => [styles.reason, on && styles.reasonOn, pressed && styles.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                {on ? <IconCheck size={11} color={colors.white} /> : null}
                <Text style={[styles.reasonText, on && styles.reasonTextOn]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Note"
          value={note}
          onChangeText={setNote}
          maxLength={REVIEW_NOTE_MAX}
          multiline
          placeholder="Get the secretary’s written OK, and a photo of the water point."
          error={error}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  reasonOn: { backgroundColor: colors.amberDeep, borderColor: colors.amberDeep },
  reasonText: { ...typography.label, fontSize: 13, fontWeight: '700', color: colors.amberDeep },
  reasonTextOn: { color: colors.white },
  pressed: { opacity: 0.8 },
});
