import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Avatar } from '../Avatar';
import { IconCheck, IconChevronRight, IconEdit, IconPlus, IconSync } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';
import { formatRelativeDate } from '../../utils/format';
import { maskPhone, ordinal } from '../../utils/customerSearch';
import type { DirectoryEntry } from '../../offline/directory';
import { PlateBadge } from './Highlight';

export interface RepeatOffer {
  /** "Foam Wash + Chain Lube" */
  summary: string;
  total: number;
  applied: boolean;
}

interface Props {
  entry: DirectoryEntry;
  vehicleTypeName: string;
  otherVehicles: DirectoryEntry[];
  vehicleTypeNameFor: (id: string) => string;
  repeat: RepeatOffer | null;
  formatMoney: (paise: number) => string;
  onRepeat: () => void;
  onChange: () => void;
  onEdit: () => void;
  onPickVehicle: (entry: DirectoryEntry) => void;
  onAddVehicle: () => void;
}

function lastSeen(lastVisit: string | null): string {
  if (!lastVisit) return 'first wash with us';
  const rel = formatRelativeDate(lastVisit);
  return /^\d/.test(rel) && !rel.includes('ago')
    ? `last here on ${rel}`
    : `last here ${rel.toLowerCase()}`;
}

/**
 * The moment a regular is recognised: greet them by name, show where they are in their
 * history, and offer last time's services in one tap.
 */
export function WelcomeCard({
  entry,
  vehicleTypeName,
  otherVehicles,
  vehicleTypeNameFor,
  repeat,
  formatMoney,
  onRepeat,
  onChange,
  onEdit,
  onPickVehicle,
  onAddVehicle,
}: Props) {
  const name = entry.customerName || 'there';
  const firstName = name.split(/\s+/)[0];
  const visitNo = entry.visitCount + 1;

  return (
    <View>
      <LinearGradient
        colors={[colors.teal, colors.waterDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View pointerEvents="none" style={styles.orb} />
        <View style={styles.top}>
          <View style={styles.avatarRing}>
            <Avatar name={name} id={entry.customerId} size={50} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>
              {entry.visitCount > 0 ? 'WELCOME BACK' : 'GOOD TO SEE YOU'}
            </Text>
            <Text
              style={styles.name}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {firstName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {ordinal(visitNo)} visit · {lastSeen(entry.lastVisit)}
            </Text>
          </View>
          <Pressable
            onPress={onChange}
            hitSlop={8}
            style={({ pressed }) => [styles.changeBtn, pressed && styles.changeBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Choose a different customer"
          >
            <Text style={styles.changeText}>Change</Text>
          </Pressable>
        </View>

        <View style={styles.divider} />

        <View style={styles.details}>
          <PlateBadge plate={entry.registrationNumber} tone="glass" />
          <Text style={styles.detailText} numberOfLines={1}>
            {vehicleTypeName} · {maskPhone(entry.customerPhone)}
          </Text>
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            style={styles.editBtn}
            accessibilityRole="button"
            accessibilityLabel="Edit customer details"
          >
            <IconEdit size={14} color={colors.white} />
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
        </View>

        {repeat ? (
          <Pressable
            onPress={onRepeat}
            disabled={repeat.applied}
            style={({ pressed }) => [
              styles.repeatBtn,
              repeat.applied && styles.repeatBtnApplied,
              pressed && styles.repeatBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: repeat.applied }}
            accessibilityLabel={`Repeat last wash: ${repeat.summary}, ${formatMoney(repeat.total)}`}
          >
            <View style={[styles.repeatIcon, repeat.applied && styles.repeatIconApplied]}>
              {repeat.applied ? (
                <IconCheck size={15} color={colors.white} />
              ) : (
                <IconSync size={15} color={colors.white} />
              )}
            </View>
            <View style={styles.repeatCopy}>
              <Text style={styles.repeatTitle}>
                {repeat.applied ? 'Last wash added' : 'Repeat last wash'}
              </Text>
              <Text style={styles.repeatSummary} numberOfLines={1}>
                {repeat.summary}
              </Text>
            </View>
            <Text style={styles.repeatPrice}>{formatMoney(repeat.total)}</Text>
          </Pressable>
        ) : null}
      </LinearGradient>

      <Text style={styles.sectionLabel}>
        {otherVehicles.length > 0 ? `${firstName}’s other vehicles` : 'Different vehicle today?'}
      </Text>
      <View style={styles.list}>
        {otherVehicles.map((v) => (
          <Pressable
            key={v.registrationNumber}
            onPress={() => onPickVehicle(v)}
            android_ripple={{ color: colors.waterPale }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Use ${v.registrationNumber}`}
          >
            <PlateBadge plate={v.registrationNumber} />
            <Text style={styles.rowText} numberOfLines={1}>
              {vehicleTypeNameFor(v.vehicleTypeId)}
            </Text>
            <IconChevronRight size={16} color={colors.slate} />
          </Pressable>
        ))}
        <Pressable
          onPress={onAddVehicle}
          android_ripple={{ color: colors.waterPale }}
          style={({ pressed }) => [styles.row, styles.rowLast, pressed && styles.rowPressed]}
          accessibilityRole="button"
        >
          <View style={styles.addIcon}>
            <IconPlus size={14} color={colors.water} />
          </View>
          <Text style={styles.addText}>Add another vehicle for {firstName}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm + 4,
    overflow: 'hidden',
    shadowColor: colors.tealDeep,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  orb: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.1)',
    top: -70,
    right: -40,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  avatarRing: { padding: 2, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.35)' },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '700',
    letterSpacing: 1.2,
    fontSize: 10,
  },
  name: {
    ...typography.title,
    color: colors.white,
    fontSize: 26,
    letterSpacing: -0.5,
    textShadowColor: 'rgba(8,47,73,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  meta: { ...typography.caption, color: 'rgba(255,255,255,0.9)', letterSpacing: 0, fontSize: 13 },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignSelf: 'flex-start',
  },
  changeBtnPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  changeText: { ...typography.label, color: colors.white, fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  details: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.92)',
    flex: 1,
    letterSpacing: 0,
    fontSize: 13,
  },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  editText: { ...typography.label, color: colors.white, fontSize: 13 },
  repeatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  repeatBtnPressed: { opacity: 0.85 },
  repeatBtnApplied: { backgroundColor: '#F0FDFA' },
  repeatIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatIconApplied: { backgroundColor: colors.teal },
  repeatCopy: { flex: 1, minWidth: 0 },
  repeatTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  repeatSummary: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  repeatPrice: { ...typography.heading, color: colors.waterInk, fontSize: 17 },
  sectionLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { ...typography.body, color: colors.slateDeep, flex: 1, fontSize: 14 },
  addIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { ...typography.bodyStrong, color: colors.water, fontSize: 15, flex: 1 },
});
