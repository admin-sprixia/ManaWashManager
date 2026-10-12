import React, { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isOpenRequest } from '@mana/domain';
import { Button, Notice, colors, formatPhone, showAlert, showToast, spacing, typography } from '@mana/ui';
import { api, send } from '../../api/client';
import { ApiError, errorMessage } from '../../api/errors';
import type { RequestPass } from '../../api/session';
import { useAuth } from '../../auth/AuthProvider';
import { HeroSheet } from '../../components/HeroSheet';
import { RequestCard } from '../../components/RequestCard';
import { useRemote } from '../../hooks/useRemote';
import type { RequestStackParams } from '../../navigation/types';

type Props = NativeStackScreenProps<RequestStackParams, 'RequestHome'> & { pass: RequestPass };

const TICKET_ENDED = 'Enter your number again to see your request.';

/** A number that isn't a customer yet: their request (if any) and how to make or change one. */
export function RequestHomeScreen({ navigation, pass }: Props) {
  const { signOut } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const mine = useRemote(() => send(api['service-requests'].mine.$post({ json: { ticket: pass.ticket } })));

  // A ticket lasts 30 days; after that the number has to be confirmed again.
  const ticketEnded = mine.failure instanceof ApiError && mine.failure.status === 401;
  useEffect(() => {
    if (ticketEnded) void signOut(TICKET_ENDED);
  }, [ticketEnded, signOut]);

  const requests = mine.data?.requests ?? [];
  const open = requests.find((r) => isOpenRequest(r.status));
  const latestHandled = open ? null : requests.find((r) => r.status !== 'cancelled');
  const invitedPlaceId = open?.invitedPlaceId ?? null;
  const joinInvited = () => invitedPlaceId && navigation.navigate('JoinPlace', { placeId: invitedPlaceId, location: open?.location ?? null });

  const cancel = (id: string) =>
    showAlert('Cancel your request?', 'The MANA team won’t call you about it. You can ask again any time.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setCancelling(true);
            try {
              await send(api['service-requests'][':id'].cancel.$post({ param: { id }, json: { ticket: pass.ticket } }));
              showToast('Request cancelled');
              await mine.reload();
            } catch (err) {
              if (err instanceof ApiError && err.status === 401) await signOut(TICKET_ENDED);
              else showToast(errorMessage(err), 'error');
            } finally {
              setCancelling(false);
            }
          })();
        },
      },
    ]);

  const useAnotherNumber = () => void signOut(null);

  return (
    <HeroSheet
      hero={{
        title: open ? 'You’re on the list' : 'Car wash where you live',
        subtitle: open
          ? 'We start at a new place when enough neighbours ask.'
          : 'Washed where you park, on your place’s wash day. Join in a minute.',
        phoneChip: { label: `+91 ${formatPhone(pass.phone)}`, onPress: useAnotherNumber },
      }}
      refreshControl={<RefreshControl refreshing={mine.refreshing} onRefresh={() => void mine.reload()} />}
    >
      {mine.loading && !mine.data ? (
        <ActivityIndicator color={colors.water} style={styles.loading} />
      ) : mine.error && !mine.data ? (
        <>
          <Notice tone="danger">{mine.error}</Notice>
          <Button label="Try again" variant="secondary" onPress={() => void mine.reload()} />
        </>
      ) : mine.data?.registered ? (
        <>
          <Notice tone="success" title="You’re a MANA customer now">
            Sign in again to see your cars, washes and free-wash cards.
          </Notice>
          <Button label="Sign in" size="lg" onPress={useAnotherNumber} />
        </>
      ) : open ? (
        <>
          {invitedPlaceId ? (
            <>
              <Notice tone="success" title="We now wash at a place near you">
                Join it in a minute: pick your home and a plan.
              </Notice>
              <Button label="Join now" size="lg" onPress={joinInvited} />
            </>
          ) : open.status === 'out_of_area' ? (
            <Notice tone="warning" title="We don’t come to your area yet">
              We’ve saved your request. We’ll start when enough neighbours join, and let you know on this number.
            </Notice>
          ) : (
            <Notice tone="info" title="We don’t come to your place yet">
              We’ll start when enough neighbours join. Tell them about MANA to get there sooner. Someone from MANA may call
              you on this number.
            </Notice>
          )}
          <RequestCard request={open} />
          <Button label="Change details" variant="secondary" onPress={() => navigation.navigate('RequestForm', { from: open })} />
          <Button label="Cancel request" variant="danger" loading={cancelling} onPress={() => cancel(open.id)} />
        </>
      ) : (
        <>
          {latestHandled?.status === 'rejected' ? (
            <Notice tone="warning" title="We couldn’t take your last request">
              {latestHandled.reason ?? 'You can send a new one with different details.'}
            </Notice>
          ) : null}
          <View style={styles.steps}>
            {[
              'Find your apartment or colony',
              'Pick a plan for each vehicle',
              'Pay online before the first wash',
            ].map((text, i) => (
              <View key={text} style={styles.step}>
                <View style={styles.stepDot}>
                  <Text style={styles.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{text}</Text>
              </View>
            ))}
          </View>
          <Button label="Find my place" size="lg" onPress={() => navigation.navigate('FindPlace')} />
          <Button
            label="Ask MANA to come here"
            variant="secondary"
            onPress={() => navigation.navigate('RequestForm', latestHandled ? { from: latestHandled } : undefined)}
          />
          <Text style={styles.hint}>Place not listed? Tell us where you live. We start when enough neighbours ask.</Text>
        </>
      )}
      <Text style={styles.footer} onPress={useAnotherNumber} accessibilityRole="button">
        Use a different number
      </Text>
    </HeroSheet>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  steps: { gap: spacing.md, paddingVertical: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { ...typography.label, color: colors.waterDeep },
  stepText: { ...typography.body, color: colors.waterInk, flex: 1 },
  hint: { ...typography.caption, color: colors.slate, textAlign: 'center' },
  footer: { ...typography.label, color: colors.water, textAlign: 'center', paddingVertical: spacing.md },
});
