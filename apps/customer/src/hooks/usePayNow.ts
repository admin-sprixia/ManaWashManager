import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { showToast } from '@mana/ui';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import type { MainStackParams } from '../navigation/types';

/**
 * "Pay now" for an order: asks for a checkout (the same one again if it's still open), opens it
 * in the browser and shows the payment screen, which waits for Razorpay's answer. The checkout's
 * return page brings the app back to that screen.
 */
export function usePayNow() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParams>>();
  const [paying, setPaying] = useState<string | null>(null);

  const pay = useCallback(
    async (orderId: string) => {
      setPaying(orderId);
      try {
        const { payment } = await send(api.orders[':id'].pay.$post({ param: { id: orderId } }));
        navigation.navigate('Payment', { paymentId: payment.id, url: payment.url });
        await Linking.openURL(payment.url).catch(() => showToast('Couldn’t open the payment page.', 'error'));
      } catch (err) {
        showToast(errorMessage(err), 'error');
      } finally {
        setPaying(null);
      }
    },
    [navigation],
  );

  return { pay, paying };
}
