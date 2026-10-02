import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { IconCheck, IconGift, IconUsers } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { FieldRow } from './FormParts';

export interface ReferralQuote {
  token: string;
  percent: number;
  referrer: { name: string | null; phone: string };
  expiresAt: string;
}

/** Renew this long before the quote runs out, so a save never races the expiry. */
const RENEW_BEFORE_MS = 2 * 60 * 1000;

export interface ReferralState {
  /** The person typed a referrer number. */
  entered: boolean;
  quote: ReferralQuote | null;
  checking: boolean;
  error: string | null;
}

const IDLE: ReferralState = { entered: false, quote: null, checking: false, error: null };

type QuoteResult = { quote: ReferralQuote } | { error: string; offline: boolean };

/**
 * Asks the server whether this referral qualifies and draws the new customer's discount.
 * Re-asked whenever the referrer, the new customer's phone or the plate changes, since the
 * signed quote is only valid for that exact combination. A quote that is about to expire is
 * renewed with the same percent, so the customer never sees their discount change.
 */
export function useReferralQuote(referrerPhone: string, phone: string, registrationNumber: string, enabled: boolean) {
  const [state, setState] = useState<ReferralState>(IDLE);
  const referrer = normalizePhone(referrerPhone);
  const entered = referrer.length > 0;
  const ready = enabled && isValidPhone(referrer);
  const key = ready ? `${referrer}|${phone}|${registrationNumber}` : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const quoteRef = useRef<ReferralQuote | null>(null);
  quoteRef.current = state.quote;

  const request = useCallback(
    async (previousToken?: string): Promise<QuoteResult> => {
      try {
        const res = await api.referrals.quote.$post({
          json: { referrerPhone: referrer, phone, registrationNumber, previousToken },
        });
        if (!res.ok) return { error: await apiErrorMessage(res, 'This referral can’t be used.'), offline: false };
        return { quote: await res.json() };
      } catch (e) {
        const offline = e instanceof NetworkError;
        return { error: offline ? 'Referral offers need internet.' : 'Couldn’t check the referral.', offline };
      }
    },
    [referrer, phone, registrationNumber],
  );

  /** Renews in place; a lost connection keeps the current quote on screen. */
  const renew = useCallback(async (): Promise<ReferralQuote | null> => {
    const current = quoteRef.current;
    const forKey = keyRef.current;
    if (!current || !forKey) return null;
    const result = await request(current.token);
    if (keyRef.current !== forKey) return null;
    if ('quote' in result) {
      setState({ entered: true, quote: result.quote, checking: false, error: null });
      return result.quote;
    }
    if (!result.offline) setState({ entered: true, quote: null, checking: false, error: result.error });
    return null;
  }, [request]);

  useEffect(() => {
    if (!key) {
      setState({ ...IDLE, entered });
      return;
    }
    let alive = true;
    setState({ entered: true, quote: null, checking: true, error: null });
    const t = setTimeout(() => {
      void request().then((result) => {
        if (!alive) return;
        setState(
          'quote' in result
            ? { entered: true, quote: result.quote, checking: false, error: null }
            : { entered: true, quote: null, checking: false, error: result.error },
        );
      });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const expiresAt = state.quote?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Math.max(5_000, new Date(expiresAt).getTime() - Date.now() - RENEW_BEFORE_MS);
    const t = setTimeout(() => void renew(), wait);
    return () => clearTimeout(t);
  }, [expiresAt, renew]);

  /** A quote safe to send with the wash right now, renewing first if it's close to expiry. */
  const ensureFresh = useCallback(async (): Promise<ReferralQuote | null> => {
    const current = quoteRef.current;
    if (!current) return null;
    if (new Date(current.expiresAt).getTime() - Date.now() > 60_000) return current;
    return renew();
  }, [renew]);

  return { ...state, ensureFresh };
}

interface ReferralFieldProps {
  value: string;
  onChange: (t: string) => void;
  state: ReferralState;
  online: boolean;
  /** Paise off the current bill once services are picked. */
  saving: number;
  formatMoney: (paise: number) => string;
}

/** "Referred by a customer?" on a genuinely new customer. Collapsed until tapped. */
export function ReferralField({ value, onChange, state, online, saving, formatMoney }: ReferralFieldProps) {
  const [open, setOpen] = useState(value.length > 0);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        android_ripple={{ color: colors.waterPale }}
        style={styles.addRow}
        accessibilityRole="button"
      >
        <View style={styles.addIcon}>
          <IconGift size={17} color={colors.tealDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.addTitle}>Referred by a customer?</Text>
          <Text style={styles.addHint}>Both get a surprise 5–10% off</Text>
        </View>
        <Text style={styles.addLink}>Add</Text>
      </Pressable>
    );
  }

  const name = state.quote?.referrer.name?.trim() || state.quote?.referrer.phone;

  return (
    <View>
      <FieldRow
        icon={<IconUsers size={17} color={colors.tealDeep} />}
        label="Referrer’s mobile number"
        prefix="+91"
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^\d+ ]/g, ''))}
        placeholder="Their number on file"
        keyboardType="phone-pad"
        maxLength={14}
        autoFocus={value.length === 0}
        last
        trailing={
          state.checking ? (
            <ActivityIndicator size="small" color={colors.teal} />
          ) : (
            <Pressable
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
              hitSlop={8}
              accessibilityLabel="Remove referral"
            >
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          )
        }
      />
      {state.quote ? (
        <View style={styles.quote}>
          <View style={styles.quoteIcon}>
            <IconCheck size={16} color={colors.white} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.quoteTitle}>
              {state.quote.percent}% off · referred by {name}
              {saving > 0 ? <Text style={styles.quoteSaving}>  −{formatMoney(saving)}</Text> : null}
            </Text>
            <Text style={styles.quoteHint}>
              {name?.split(/\s+/)[0]} gets their own reward once this wash is paid.
            </Text>
          </View>
        </View>
      ) : state.error ? (
        <Text style={styles.error}>{state.error}</Text>
      ) : !online && state.entered ? (
        <Text style={styles.error}>Referral offers need internet.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  addHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  addLink: { ...typography.label, color: colors.teal, fontSize: 14 },
  remove: { ...typography.label, color: colors.danger, fontSize: 13 },
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  quoteIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteTitle: { ...typography.bodyStrong, color: colors.tealDeep, fontSize: 15 },
  quoteSaving: { color: colors.teal, fontWeight: '800' },
  quoteHint: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  error: {
    ...typography.caption,
    color: colors.danger,
    letterSpacing: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
});
