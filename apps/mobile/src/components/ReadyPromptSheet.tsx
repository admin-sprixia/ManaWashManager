import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import type { BoardJob } from '../offline/types';
import { buildReadyMessage } from '../utils/messages';
import { customerLine } from '../utils/jobs';
import { openWhatsApp } from '../utils/whatsapp';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { IconWhatsApp } from './Icons';

/** Shown right after a job moves to Ready: one tap tells the customer to come back. */
export function ReadyPromptSheet({ job, onClose }: { job: BoardJob | null; onClose: () => void }) {
  if (!job) return <BottomSheet visible={false} onClose={onClose} title="" />;

  const message = buildReadyMessage({
    customerName: job.customer.name,
    registrationNumber: job.vehicle.registrationNumber,
    vehicleType: job.vehicle.vehicleType.name,
    total: job.total,
  });

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Ready for pickup"
      subtitle={`Let ${customerLine(job)} know it’s done?`}
      footer={
        <>
          <Button
            label="Send on WhatsApp"
            size="lg"
            icon={<IconWhatsApp size={20} color={colors.white} />}
            onPress={() => {
              void openWhatsApp(job.customer.phone, message);
              onClose();
            }}
          />
          <Button label="Not now" variant="ghost" onPress={onClose} />
        </>
      }
    >
      <View style={styles.preview}>
        <Text style={styles.previewText}>{message}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: '#E7F8EE',
    borderRadius: radius.md,
    borderTopLeftRadius: 4,
    padding: spacing.md,
  },
  previewText: { ...typography.body, color: colors.waterInk, fontSize: 14, lineHeight: 20 },
});
