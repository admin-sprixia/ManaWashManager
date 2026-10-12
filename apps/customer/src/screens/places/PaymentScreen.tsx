import React, { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatInr } from '@mana/domain';
import { Button, colors, showToast, spacing } from '@mana/ui';
import { api, send } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { MessageCard } from '../../components/MessageCard';
import { OutcomeCard } from '../../components/places/OutcomeCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useRemote } from '../../hooks/useRemote';
import { usePageStyle } from '../../layout/Layout';
import type { MainStackParams } from '../../navigation/types';
import { washDayLine } from '../../places/format';

type Props = NativeStackScreenProps<MainStackParams, 'Payment'>;

const POLL_MS = 3000;

/**
 * After the checkout opens: waits for Razorpay's answer (checking every few seconds), then says
 * plainly what happened. Also where the checkout's return page brings the app back to.
 */
export function PaymentScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const { paymentId, url } = route.params;
  const [retrying, setRetrying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const remote = useRemote(
    async () => {
      const { payment } = await send(api.payments[':id'].$get({ param: { id: paymentId } }));
      setStatus(payment.status);
      const order =
        payment.status === 'paid' && payment.orderId
          ? (await send(api.orders[':id'].$get({ param: { id: payment.orderId } })).catch(() => null))?.order ?? null
          : null;
      return { payment, order };
    },
    { pollMs: status === 'created' || status == null ? POLL_MS : null },
  );

  const data = remote.data?.payment.id === paymentId ? remote.data : null;
  const payment = data?.payment ?? null;
  const orderId = payment?.orderId ?? null;

  const payAgain = async () => {
    if (!orderId) return;
    setRetrying(true);
    try {
      const { payment: next } = await send(api.orders[':id'].pay.$post({ param: { id: orderId } }));
      setStatus(null);
      navigation.setParams({ paymentId: next.id, url: next.url });
      await Linking.openURL(next.url).catch(() => showToast('Couldn’t open the payment page.', 'error'));
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setRetrying(false);
    }
  };

  const toPlan = () => {
    const { routes, index } = navigation.getState();
    const below = routes[index - 1];
    const planBelow = below?.name === 'Plan' && (below.params as MainStackParams['Plan'] | undefined)?.orderId === orderId;
    if (!orderId || planBelow) navigation.goBack();
    else navigation.replace('Plan', { orderId });
  };

  let body: React.ReactNode;
  if (!payment) {
    body = remote.error ? (
      <MessageCard
        title="Couldn’t check the payment"
        body={remote.error}
        action={{ label: 'Try again', onPress: () => void remote.reload() }}
      />
    ) : (
      <ActivityIndicator style={styles.loading} color={colors.water} size="large" />
    );
  } else if (payment.status === 'paid') {
    const next = data?.order?.nextWashes[0];
    body = (
      <OutcomeCard
        tone="done"
        title="Payment received"
        body={`${formatInr(payment.amount)} paid.${next && data?.order ? ` See you on ${washDayLine(next, data.order.place.washTime)}.` : ''}`}
      >
        {payment.receiptNo ? (
          <Button label="See receipt" variant="secondary" onPress={() => navigation.replace('Receipt', { paymentId: payment.id })} />
        ) : null}
        <Button label="Done" onPress={toPlan} />
      </OutcomeCard>
    );
  } else if (payment.status === 'failed' || payment.status === 'expired') {
    body = (
      <OutcomeCard
        tone="failed"
        title={payment.status === 'failed' ? 'The payment didn’t go through' : 'This payment page expired'}
        body={payment.status === 'failed' ? 'No money was taken. You can try again.' : 'No money was taken. Open a new one to pay.'}
      >
        <Button label="Try again" loading={retrying} onPress={() => void payAgain()} />
        <Button label="Later" variant="ghost" onPress={toPlan} />
      </OutcomeCard>
    );
  } else {
    body = (
      <OutcomeCard
        tone="working"
        title="Waiting for your payment"
        body={`Finish paying ${formatInr(payment.amount)} on the Razorpay page. This screen updates by itself.`}
      >
        {url ? (
          <Button
            label="Open the payment page"
            onPress={() => void Linking.openURL(url).catch(() => showToast('Couldn’t open the payment page.', 'error'))}
          />
        ) : null}
        <Button label="I’ll pay later" variant="ghost" onPress={toPlan} />
      </OutcomeCard>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Payment" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.content, pageStyle]}>
        <View>{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
});
