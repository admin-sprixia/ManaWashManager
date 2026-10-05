import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { REFERRAL_OFFER_TEXT, referralShareMessage } from '@mana/domain';
import {
  Button,
  Gradient,
  IconGift,
  IconShare,
  IconUserPlus,
  IconWhatsApp,
  Notice,
  brandGradients,
  colors,
  formatPhone,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgePanel, EdgeRow, Pill, SectionLabel, cardShell } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import { api, send } from '../api/client';
import { useAccount } from '../auth/AuthProvider';
import { useRemote } from '../hooks/useRemote';
import type { MainStackParams } from '../navigation/types';
import { shareOnWhatsApp, shareText } from '../utils/contact';

type Props = NativeStackScreenProps<MainStackParams, 'Refer'>;

const STEPS = [
  { title: 'Share your number', body: 'Send your friend a message with your number from here.' },
  { title: 'They visit MANA', body: `They give your number at the counter and get ${REFERRAL_OFFER_TEXT} their first wash.` },
  { title: 'You get a coupon', body: `Once they've paid, you get ${REFERRAL_OFFER_TEXT} your next wash.` },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Invite a friend: the share message, how the reward works, and friends who already came. */
export function ReferScreen({ navigation }: Props) {
  const account = useAccount();
  const referrals = useRemote(() => send(api.referrals.$get()));
  const message = referralShareMessage({
    phone: formatPhone(account.phone),
    city: account.branches.length === 1 ? account.branches[0]!.city : null,
  });
  const canRefer = referrals.data?.canRefer ?? false;
  const friends = referrals.data?.referrals ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Invite friends" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={referrals.refreshing} onRefresh={() => void referrals.reload()} />}
      >
        <View style={styles.heroShell}>
          <Gradient spec={brandGradients.promo} style={styles.hero}>
            <View style={styles.heroIcon}>
              <IconGift size={26} color={colors.white} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.heroTitle}>Wash together, save together</Text>
              <Text style={styles.heroBody}>
                Your friend gets {REFERRAL_OFFER_TEXT} their first wash, and you get {REFERRAL_OFFER_TEXT} your next one.
              </Text>
            </View>
          </Gradient>
        </View>

        <SectionLabel>Your invite</SectionLabel>
        {referrals.loading ? (
          <ActivityIndicator color={colors.water} />
        ) : referrals.error && !referrals.data ? (
          <View style={styles.pad}>
            <Notice tone="warning">{referrals.error}</Notice>
          </View>
        ) : !canRefer ? (
          <View style={styles.pad}>
            <Notice tone="info" title="After your first wash">
              You can invite friends once you’ve had a paid wash at MANA.
            </Notice>
          </View>
        ) : (
          <EdgePanel>
            <View style={styles.message}>
              <Text style={styles.messageText}>{message}</Text>
            </View>
            <Button
              label="Share on WhatsApp"
              icon={<IconWhatsApp size={20} variant="mono" color={colors.white} />}
              onPress={() => shareOnWhatsApp(message)}
            />
            <Button
              label="Share another way"
              variant="secondary"
              icon={<IconShare size={18} color={colors.water} />}
              onPress={() => void shareText(message)}
            />
          </EdgePanel>
        )}

        <SectionLabel>How it works</SectionLabel>
        <EdgePanel>
          {STEPS.map((s, i) => (
            <View key={s.title} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.fine}>Only for friends visiting MANA for the first time.</Text>
        </EdgePanel>

        {friends.length > 0 ? (
          <>
            <SectionLabel>Friends you invited</SectionLabel>
            <EdgeGroup>
              {friends.map((f) => (
                <EdgeRow
                  key={f.id}
                  icon={<IconUserPlus size={19} color={colors.waterDeep} />}
                  title={f.friend ?? 'A friend'}
                  subtitle={`${shortDate(f.createdAt)}${account.branches.length > 1 ? ` · ${f.branch.name}` : ''}`}
                  right={
                    <Pill
                      label={f.status === 'pending' ? 'NOT PAID YET' : 'VISITED'}
                      tone={f.status === 'pending' ? 'amber' : 'teal'}
                    />
                  }
                />
              ))}
            </EdgeGroup>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.md },
  content: { paddingBottom: spacing.xl },
  pad: { paddingHorizontal: spacing.md },
  flex: { flex: 1, gap: 2 },
  heroShell: {
    ...cardShell,
    marginTop: 20,
    backgroundColor: colors.indigoMid,
    borderWidth: 0,
    shadowColor: colors.indigoMid,
    shadowOpacity: 0.32,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: radius.lg },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.white },
  heroBody: { fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.86)' },
  message: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
  },
  messageText: { ...typography.body, color: colors.waterInk, fontSize: 15, lineHeight: 22 },
  step: { flexDirection: 'row', gap: spacing.sm + 4, alignItems: 'flex-start' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { ...typography.label, color: colors.waterDeep },
  stepTitle: { ...typography.bodyStrong, color: colors.waterInk },
  stepBody: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  fine: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
});
