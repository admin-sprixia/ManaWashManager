import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  showToast,
  IconAlert,
  IconCheck,
  IconClose,
  IconShare,
  IconStar,
  IconStore,
  IconWhatsApp,
} from '@mana/ui';
import { httpsHost, isGoogleReviewUrl } from '@mana/domain';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { SheetHead, SheetNotice, SheetPill } from './SheetBits';

const STEPS = [
  'Open Google Business Profile (or search your shop name on Google).',
  'Tap “Ask for reviews” or “Get more reviews”.',
  'Copy the link and long-press the box above to paste it.',
];

/** Owner sets the Google review link that goes at the end of every thank-you message. */
export function ReviewLinkSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { googleReviewUrl, setGoogleReviewUrl, info } = useShop();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setUrl(googleReviewUrl ?? '');
    setError(null);
    setBusy(false);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmed = url.trim();
  const valid = trimmed === '' || isGoogleReviewUrl(trimmed);
  const looksGoogle = trimmed !== '' && valid;
  const changed = trimmed !== (googleReviewUrl ?? '');
  const removing = changed && trimmed === '' && googleReviewUrl != null;
  const saved = googleReviewUrl != null && googleReviewUrl !== '';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.shop.settings.$put({ json: { googleReviewUrl: trimmed || null } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save the link.'));
        return;
      }
      const body = await res.json();
      setGoogleReviewUrl(body.googleReviewUrl);
      showToast(body.googleReviewUrl ? 'Review link saved' : 'Review link removed');
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Saving needs a connection.' : 'Couldn’t save the link.');
    } finally {
      setBusy(false);
    }
  };

  const hint = !valid
    ? {
        tone: 'bad' as const,
        text: httpsHost(trimmed)
          ? 'Only a Google review link works here (g.page, maps.app.goo.gl or google.com).'
          : 'Paste the full link, starting with https://',
      }
    : !trimmed
      ? { tone: 'muted' as const, text: 'Leave empty to send thank-you messages without a review ask.' }
      : { tone: 'ok' as const, text: 'A Google link — tap Test to make sure it opens your page.' };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Google review link"
      subtitle="Happy customers get it in their WhatsApp thank-you."
      footer={
        <Button
          label={removing ? 'Remove link' : saved && !changed ? 'Saved' : 'Save link'}
          variant={removing ? 'danger' : 'primary'}
          size="lg"
          loading={busy}
          disabled={!valid || !changed}
          onPress={() => void save()}
        />
      }
    >
      <SheetHead
        tone={saved ? 'teal' : 'amber'}
        icon={<IconStar size={22} color={saved ? colors.teal : colors.amber} />}
        title={saved ? 'Review ask is on' : 'Review ask is off'}
        caption={
          saved
            ? 'Every thank-you message ends with your Google review link.'
            : 'Add your Google link to turn happy washes into reviews.'
        }
        right={<SheetPill tone={saved ? 'teal' : 'amber'} label={saved ? 'On' : 'Not set'} />}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Your review link</Text>
        <View
          style={[
            styles.inputWrap,
            focused && styles.inputFocus,
            !valid && styles.inputError,
          ]}
        >
          <View style={[styles.inputIcon, looksGoogle && styles.inputIconOk]}>
            {looksGoogle ? <IconCheck size={14} color={colors.white} /> : <IconStar size={14} color={colors.waterDeep} />}
          </View>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={(t) => {
              setUrl(t);
              setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="https://g.page/r/…/review"
            placeholderTextColor={colors.slate}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={300}
            numberOfLines={1}
          />
          {url ? (
            <Pressable
              onPress={() => setUrl('')}
              hitSlop={8}
              style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Clear link"
            >
              <IconClose size={12} color={colors.slateDeep} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.hintRow}>
          {hint.tone === 'bad' ? (
            <IconAlert size={13} color={colors.danger} />
          ) : hint.tone === 'ok' ? (
            <IconCheck size={13} color={colors.tealDeep} />
          ) : null}
          <Text
            style={[
              styles.hint,
              hint.tone === 'bad' && { color: colors.danger },
              hint.tone === 'ok' && { color: colors.tealDeep },
            ]}
          >
            {hint.text}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => void Linking.openURL(trimmed).catch(() => showToast('Couldn’t open this link', 'error'))}
          disabled={!trimmed || !valid}
          style={({ pressed }) => [styles.actionBtn, (!trimmed || !valid) && styles.actionOff, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconShare size={15} color={colors.waterDeep} />
          <Text style={styles.actionText}>Test link</Text>
        </Pressable>
        <Pressable
          onPress={() => void Linking.openURL('https://business.google.com/').catch(() => undefined)}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconStore size={15} color={colors.waterDeep} />
          <Text style={styles.actionText}>Find my link</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Customers will see</Text>
        <View style={styles.chat}>
          <View style={styles.bubble}>
            <View style={styles.bubbleHead}>
              <IconWhatsApp size={13} variant="brand" />
              <Text style={styles.bubbleFrom}>{info?.name ?? 'Your shop'}</Text>
            </View>
            {trimmed && valid ? (
              <>
                <Text style={styles.bubbleBold}>⭐ Got 30 seconds?</Text>
                <Text style={styles.bubbleText}>
                  If you loved the shine, a quick Google review would truly make our day 🙏
                </Text>
                <Text style={styles.bubbleLink} numberOfLines={2}>
                  👉 {trimmed}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bubbleText}>See you next time!</Text>
                <Text style={styles.bubbleMuted}>No review ask — add a link to start collecting reviews.</Text>
              </>
            )}
            <Text style={styles.bubbleTime}>now ✓✓</Text>
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>How to get your link</Text>
        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.stepRow, i < STEPS.length - 1 && styles.stepDivider]}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>
      </View>

      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  field: { gap: 8 },
  label: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0.1 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 56,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.sm + 4,
  },
  inputFocus: { borderColor: colors.water, backgroundColor: colors.white },
  inputError: { borderColor: '#FCA5A5' },
  inputIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputIconOk: { backgroundColor: colors.teal },
  input: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.waterInk, paddingVertical: 0 },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  hint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, lineHeight: 17, flex: 1 },

  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  actionOff: { opacity: 0.45 },
  actionText: { ...typography.label, fontSize: 13.5, color: colors.waterDeep },

  chat: {
    backgroundColor: '#ECE5DD',
    borderRadius: radius.md,
    padding: spacing.sm + 4,
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderTopLeftRadius: 3,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    gap: 3,
  },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  bubbleFrom: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: '#128C7E', letterSpacing: 0 },
  bubbleBold: { fontSize: 14, fontWeight: '800', color: '#111B21' },
  bubbleText: { fontSize: 14, color: '#111B21', lineHeight: 19 },
  bubbleLink: { fontSize: 14, color: '#027EB5', textDecorationLine: 'underline', lineHeight: 19 },
  bubbleMuted: { fontSize: 12.5, color: colors.slate, fontStyle: 'italic', lineHeight: 17 },
  bubbleTime: { fontSize: 10.5, color: '#667781', alignSelf: 'flex-end', marginTop: 2 },

  steps: {
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm + 4,
    overflow: 'hidden',
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  stepDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: colors.waterDeep, letterSpacing: 0 },
  stepText: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, flex: 1, lineHeight: 19 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', flex: 1 },
});
