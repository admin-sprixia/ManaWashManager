import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../Avatar';
import { IconAlert } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';
import { formatPhone, maskPhone } from '../../utils/customerSearch';

/** Teal strip under the form: "we know this person / vehicle", with an optional action. */
export function KnownNotice({
  name,
  id,
  eyebrow,
  body,
  actionLabel,
  onAction,
}: {
  name: string;
  id: string;
  eyebrow: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.known}>
      <Avatar name={name || '?'} id={id} size={38} />
      <View style={styles.flex}>
        <Text style={styles.knownEyebrow}>{eyebrow}</Text>
        <Text style={styles.knownName} numberOfLines={1}>
          {name || 'Unnamed customer'}
        </Text>
        <Text style={styles.knownBody}>{body}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.knownBtn, pressed && styles.knownBtnPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.knownBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type OwnershipChoice = 'same_person' | 'new_owner';

interface OwnershipProps {
  plate: string;
  ownerName: string;
  ownerPhone: string;
  newPhone: string;
  /** Another saved customer already uses the typed number. */
  holderName: string | null;
  value: OwnershipChoice | null;
  onChange: (choice: OwnershipChoice) => void;
}

/**
 * A known vehicle came in with someone else's number. Guessing either way corrupts history,
 * so ask once: did the owner change numbers, or did the vehicle change hands?
 */
export function OwnershipQuestion({
  plate,
  ownerName,
  ownerPhone,
  newPhone,
  holderName,
  value,
  onChange,
}: OwnershipProps) {
  const owner = ownerName || 'the saved owner';
  const options: { id: OwnershipChoice; title: string; body: string; disabled?: boolean }[] = [
    {
      id: 'same_person',
      title: `Same person, new number`,
      body: holderName
        ? `Not possible — ${formatPhone(newPhone)} is already ${holderName}’s number.`
        : `Update ${owner}’s number to ${formatPhone(newPhone)}. Their history stays together.`,
      disabled: Boolean(holderName),
    },
    {
      id: 'new_owner',
      title: holderName ? `Belongs to ${holderName} now` : 'New owner',
      body: holderName
        ? `Move ${plate} to ${holderName}. Past visits stay with ${owner}.`
        : `Start a fresh profile for this number. Past visits stay with ${owner}.`,
    },
  ];

  return (
    <View style={styles.owner}>
      <View style={styles.ownerHead}>
        <View style={styles.ownerIcon}>
          <IconAlert size={16} color={colors.amberDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.ownerTitle}>Who owns {plate} now?</Text>
          <Text style={styles.ownerBody}>
            It’s saved under {owner} ({maskPhone(ownerPhone)}), but you entered a different number.
          </Text>
        </View>
      </View>
      <View style={styles.options} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => !o.disabled && onChange(o.id)}
              disabled={o.disabled}
              style={[styles.option, on && styles.optionOn, o.disabled && styles.optionDisabled]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: o.disabled }}
            >
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={[styles.optionTitle, o.disabled && styles.optionTitleDisabled]}>
                  {o.title}
                </Text>
                <Text style={styles.optionBody}>{o.body}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  known: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: '#F0FDFA',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#99F6E4',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  knownEyebrow: {
    ...typography.caption,
    color: colors.tealDeep,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1,
  },
  knownName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  knownBody: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  knownBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  knownBtnPressed: { backgroundColor: colors.tealDeep },
  knownBtnText: { ...typography.label, color: colors.white, fontSize: 13 },
  owner: {
    backgroundColor: '#FFFBEB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.amberLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm + 2,
  },
  ownerHead: { flexDirection: 'row', gap: spacing.sm + 2, alignItems: 'flex-start' },
  ownerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  ownerBody: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 1 },
  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#F3E3B5',
    padding: spacing.sm + 4,
  },
  optionOn: { borderColor: colors.water, backgroundColor: '#F0F9FF' },
  optionDisabled: { opacity: 0.55 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: colors.water },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.water },
  optionTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  optionTitleDisabled: { color: colors.slateDeep },
  optionBody: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 1 },
});
