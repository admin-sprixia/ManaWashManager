import React, { useCallback, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatDay, formatInr } from '@mana/domain';
import { Button, colors, spacing } from '@mana/ui';
import { EdgeGroup, EdgeRow, SectionLabel } from '../../components/CardList';
import { OutcomeCard } from '../../components/places/OutcomeCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { usePayNow } from '../../hooks/usePayNow';
import { usePageStyle } from '../../layout/Layout';
import type { MainStackParams } from '../../navigation/types';
import { deadlineLine } from '../../places/format';

type Props = NativeStackScreenProps<MainStackParams, 'JoinResult'>;

/**
 * Right after joining. At the place: "You're in", with a Pay button per vehicle (payment before
 * the first wash). From elsewhere: "Almost done", the team confirms first and payment opens then.
 */
export function JoinResultScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const { result, placeLabel } = route.params;
  const { pay, paying } = usePayNow();
  const pending = result.memberStatus === 'pending';
  const toPay = result.orders.filter((o) => o.status === 'awaiting_payment');
  const waiting = result.orders.filter((o) => o.status === 'waitlist');
  const first = [...toPay].sort((a, b) => (a.firstWashOn ?? '').localeCompare(b.firstWashOn ?? ''))[0];

  const done = useCallback(
    () => navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'MyPlace', params: { memberId: result.memberId } }] }),
    [navigation, result.memberId],
  );

  // Back never returns to the join form (or out of the app, after a new number's sign-in): it opens the place.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
        e.preventDefault();
        done();
      }),
    [navigation, done],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title={placeLabel} onBack={done} />
      <ScrollView contentContainerStyle={[styles.content, pageStyle]}>
        {pending ? (
          <OutcomeCard
            tone="waiting"
            title="Almost done!"
            body={`We’ve sent your details to the team at ${placeLabel}. They’ll confirm and call you today. You pay once they confirm.`}
          />
        ) : (
          <OutcomeCard
            tone="done"
            title="You’re in!"
            body={
              first?.firstWashOn
                ? `First wash ${formatDay(first.firstWashOn)}.${first.payBy ? ` Please pay before ${deadlineLine(first.payBy)} so the washer sees “Paid”.` : ''}`
                : 'Welcome to your place.'
            }
          />
        )}

        {!pending && toPay.length ? (
          <>
            <SectionLabel>To pay</SectionLabel>
            <EdgeGroup>
              {toPay.map((o) => (
                <EdgeRow
                  key={o.id}
                  title={o.title}
                  titleLines={2}
                  subtitle={o.payBy ? `Pay before ${deadlineLine(o.payBy)}` : undefined}
                  right={<Text style={styles.amount}>{formatInr(o.dueNow)}</Text>}
                  onPress={() => navigation.navigate('Plan', { orderId: o.id })}
                />
              ))}
            </EdgeGroup>
            <View style={styles.actions}>
              {toPay.map((o) => (
                <Button
                  key={o.id}
                  label={toPay.length > 1 ? `Pay for ${o.title}` : 'Pay now'}
                  size="lg"
                  loading={paying === o.id}
                  disabled={paying != null && paying !== o.id}
                  onPress={() => void pay(o.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {waiting.length ? (
          <>
            <SectionLabel>Waiting list</SectionLabel>
            <EdgeGroup>
              {waiting.map((o) => (
                <EdgeRow key={o.id} title={o.title} titleLines={2} subtitle="The place is full. We’ll tell you when a spot opens." />
              ))}
            </EdgeGroup>
          </>
        ) : null}

        <View style={styles.actions}>
          <Button label="See my place" variant={!pending && toPay.length ? 'secondary' : 'primary'} size="lg" onPress={done} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  amount: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  actions: { paddingHorizontal: 16, paddingTop: spacing.lg, gap: spacing.sm },
});
