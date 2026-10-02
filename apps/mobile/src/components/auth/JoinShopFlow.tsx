import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  formatShopCode,
  isValidShopCode,
  JOIN_REQUEST_TTL_DAYS,
  SHOP_CODE_LENGTH,
} from '@mana/domain';
import { Button } from '../Button';
import { IconClock, IconLock, IconStore } from '../Icons';
import { showAlert } from '../AppAlert';
import { colors, radius, spacing, typography } from '../../theme';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import {
  clearJoinRequest,
  setJoinRequest,
  setLoginHints,
  type SessionUser,
} from '../../api/session';
import { ChoosePin } from './ChoosePin';
import { CodeEntry } from './CodeEntry';
import { describeError, useSignupCode } from './useSignupCode';

type Step = 'shop' | 'confirm' | 'code' | 'name' | 'waiting' | 'pin' | 'closed';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

interface ShopSummary {
  code: string;
  name: string;
  city: string | null;
}

interface JoinBody {
  requestToken?: string;
  status?: Status;
  shop?: ShopSummary;
  token?: string;
  user?: SessionUser;
  error?: string;
  message?: string;
}

/** How often the waiting screen checks for the owner's answer while it's open. */
const POLL_MS = 15_000;

const CLOSED_MESSAGE: Record<Exclude<Status, 'pending' | 'approved'>, string> = {
  rejected: 'The owner didn’t approve this request. Check the shop ID with them and try again.',
  cancelled: 'This request was cancelled.',
  expired: `The owner didn’t answer within ${JOIN_REQUEST_TTL_DAYS} days, so the request expired.`,
};

function shopLine(shop: ShopSummary) {
  return shop.city ? `${shop.name}, ${shop.city}` : shop.name;
}

/**
 * Someone who works at a shop asks to join it: shop ID → confirm the shop's name → WhatsApp code
 * → their name → wait for the owner. Once approved they choose their own PIN and are signed in.
 * The request is saved on the phone, so closing the app keeps them on the waiting screen.
 */
export function JoinShopFlow({
  phone,
  resumeToken,
  onBack,
}: {
  phone: string;
  resumeToken?: string;
  onBack: () => void;
}) {
  const { signIn } = useAuth();
  const otp = useSignupCode(phone, 'join');
  const [step, setStep] = useState<Step>(resumeToken ? 'waiting' : 'shop');
  const [shopCode, setShopCode] = useState('');
  const [shop, setShop] = useState<ShopSummary | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [requestToken, setRequestToken] = useState<string | null>(resumeToken ?? null);
  const [closedReason, setClosedReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const close = useCallback(async (reason: string) => {
    await clearJoinRequest();
    setRequestToken(null);
    setClosedReason(reason);
    setError(null);
    setStep('closed');
  }, []);

  const findShop = async () => {
    if (!isValidShopCode(shopCode) || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.signup.shops[':code'].$get({ param: { code: shopCode } });
      const body = (await res.json().catch(() => null)) as
        (ShopSummary & { message?: string }) | null;
      if (!res.ok || !body?.name) throw new Error(body?.message ?? 'Couldn’t find that shop.');
      setShop({ code: body.code, name: body.name, city: body.city });
      go('confirm');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmShop = async () => {
    setError(null);
    if (await otp.request()) {
      otp.setCode('');
      go('code');
    }
  };

  const verify = async (value: string) => {
    const next = await otp.verify(value);
    if (next) {
      setTicket(next);
      go('name');
    }
  };

  const sendRequest = async () => {
    if (!ticket || !shop || !name.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.signup.join.$post({
        json: { ticket, shopCode: shop.code, name: name.trim() },
      });
      const body = (await res.json().catch(() => null)) as JoinBody | null;
      if (!res.ok || !body?.requestToken) {
        if (body?.error === 'ticket_expired') {
          setTicket(null);
          go('confirm');
        }
        throw new Error(body?.message ?? 'Couldn’t send the request.');
      }
      await setJoinRequest({ phone, requestToken: body.requestToken });
      setRequestToken(body.requestToken);
      go('waiting');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = useCallback(async () => {
    if (!requestToken) return;
    setChecking(true);
    try {
      const res = await api.signup.join.status.$post({ json: { requestToken } });
      const body = (await res.json().catch(() => null)) as JoinBody | null;
      if (res.status === 404) return close(body?.message ?? CLOSED_MESSAGE.cancelled);
      if (!res.ok || !body?.status) return;
      if (body.shop) setShop(body.shop);
      if (body.status === 'approved') setStep('pin');
      else if (body.status !== 'pending') void close(CLOSED_MESSAGE[body.status]);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setChecking(false);
    }
  }, [requestToken, close]);

  useEffect(() => {
    if (step !== 'waiting') return;
    void checkStatus();
    const timer = setInterval(() => void checkStatus(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkStatus();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [step, checkStatus]);

  const cancelRequest = () =>
    showAlert(
      'Cancel this request?',
      'The owner won’t see it any more. You can ask again later.',
      [
        { text: 'Keep waiting', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () => {
            if (requestToken)
              void api.signup.join.cancel.$post({ json: { requestToken } }).catch(() => undefined);
            void clearJoinRequest().then(onBack);
          },
        },
      ],
    );

  const finish = async (pin: string): Promise<string | null> => {
    if (!requestToken) return 'This request isn’t available any more.';
    try {
      const res = await api.signup.join.complete.$post({ json: { requestToken, pin } });
      const body = (await res.json().catch(() => null)) as JoinBody | null;
      if (res.ok && body?.token && body.user) {
        await clearJoinRequest();
        await setLoginHints(phone, 'pin');
        await signIn(body.token, body.user);
        return null;
      }
      if (body?.error === 'pin_already_set') {
        await clearJoinRequest();
        showAlert('You already have a PIN', body.message ?? 'Sign in with your number and PIN.', undefined, {
          icon: <IconLock size={26} color={colors.waterDeep} />,
        });
        onBack();
        return null;
      }
      if (body?.error === 'weak_pin') return body.message ?? 'Choose a harder PIN.';
      if (res.status === 404 || res.status === 403) {
        void close(body?.message ?? 'This request isn’t available any more.');
        return null;
      }
      return body?.message ?? 'Couldn’t save the PIN.';
    } catch (e) {
      return describeError(e, 'Couldn’t save the PIN.');
    }
  };

  if (step === 'shop') {
    return (
      <>
        <Text style={styles.title}>Enter your shop ID</Text>
        <Text style={styles.subtitle}>
          Ask your owner for it — it’s the {SHOP_CODE_LENGTH}-digit number in their app under More.
        </Text>
        <TextInput
          style={[styles.bigInput, error ? styles.fieldError : null]}
          value={formatShopCode(shopCode)}
          onChangeText={(t) => {
            setShopCode(t.replace(/\D/g, '').slice(0, SHOP_CODE_LENGTH));
            if (error) setError(null);
          }}
          placeholder="482 193"
          placeholderTextColor={colors.border}
          keyboardType="number-pad"
          maxLength={SHOP_CODE_LENGTH + 1}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => void findShop()}
          accessibilityLabel="Shop ID"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button
            label="Find shop"
            size="lg"
            onPress={() => void findShop()}
            loading={busy}
            disabled={!isValidShopCode(shopCode)}
          />
        </View>
        <View style={styles.linkRow}>
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (step === 'confirm' && shop) {
    return (
      <>
        <Text style={styles.title}>Is this your shop?</Text>
        <View style={styles.shopCard}>
          <View style={styles.shopIcon}>
            <IconStore size={22} color={colors.waterDeep} />
          </View>
          <View style={styles.shopCopy}>
            <Text style={styles.shopName}>{shop.name}</Text>
            <Text style={styles.shopMeta}>
              {shop.city ? `${shop.city} · ` : ''}Shop ID {formatShopCode(shop.code)}
            </Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          We’ll send a code on WhatsApp to check it’s your number, then ask the owner to let you in.
        </Text>
        {error || otp.error ? <Text style={styles.error}>{error ?? otp.error}</Text> : null}
        <View style={styles.actions}>
          <Button
            label="Yes, ask to join"
            size="lg"
            onPress={() => void confirmShop()}
            loading={otp.sending}
          />
        </View>
        <View style={styles.linkRow}>
          <Pressable onPress={() => go('shop')} hitSlop={8}>
            <Text style={styles.link}>Not this shop</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (step === 'code') {
    return (
      <>
        <CodeEntry
          phone={phone}
          value={otp.code}
          onChange={(v) => {
            otp.setCode(v);
            if (otp.error) otp.setError(null);
          }}
          onComplete={(v) => void verify(v)}
          loading={otp.checking}
          sending={otp.sending}
          error={otp.error}
          resendIn={otp.resendIn}
          onResend={() => void otp.request()}
        />
        <View style={styles.linkRow}>
          <Pressable onPress={() => go('confirm')} hitSlop={8}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (step === 'name' && shop) {
    return (
      <>
        <Text style={styles.title}>Your name</Text>
        <Text style={styles.subtitle}>
          The owner of {shop.name} will see this with your number.
        </Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Ravi Kumar"
          placeholderTextColor={colors.slate}
          autoCapitalize="words"
          autoFocus
          maxLength={60}
          returnKeyType="send"
          onSubmitEditing={() => void sendRequest()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button
            label="Send request"
            size="lg"
            onPress={() => void sendRequest()}
            loading={busy}
            disabled={!name.trim()}
          />
        </View>
      </>
    );
  }

  if (step === 'waiting') {
    return (
      <>
        <View style={styles.waitIcon}>
          <IconClock size={30} color={colors.waterDeep} />
        </View>
        <Text style={[styles.title, styles.center]}>Waiting for the owner</Text>
        <Text style={[styles.subtitle, styles.center]}>
          {shop
            ? `We’ve asked ${shopLine(shop)} to let you in. `
            : 'Your request is with the owner. '}
          This screen moves on by itself once they approve.
        </Text>
        <View style={styles.status}>
          {checking ? (
            <ActivityIndicator color={colors.water} />
          ) : error ? (
            <Text style={[styles.error, styles.center]}>{error}</Text>
          ) : (
            <Text style={[styles.helper, styles.center]}>
              Tip: tell your owner to open More → Team in their app.
            </Text>
          )}
        </View>
        <Button
          label="Check now"
          variant="secondary"
          onPress={() => void checkStatus()}
          disabled={checking}
        />
        <Pressable onPress={cancelRequest} hitSlop={8} style={styles.centerLink}>
          <Text style={styles.dangerLink}>Cancel request</Text>
        </Pressable>
      </>
    );
  }

  if (step === 'pin') {
    return (
      <ChoosePin
        greeting={shop ? `You’re in ${shop.name}! Choose a PIN` : 'You’re in! Choose a PIN'}
        onDone={finish}
      />
    );
  }

  return (
    <>
      <Text style={styles.title}>Request closed</Text>
      <Text style={styles.subtitle}>{closedReason}</Text>
      <View style={styles.actions}>
        <Button
          label="Try again"
          size="lg"
          onPress={() => {
            setShopCode('');
            setShop(null);
            setTicket(null);
            go('shop');
          }}
        />
      </View>
      <View style={styles.linkRow}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.waterInk },
  subtitle: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: spacing.xs,
  },
  center: { textAlign: 'center' },
  bigInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    fontSize: 30,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    marginTop: spacing.sm,
  },
  fieldError: { borderColor: '#FCA5A5' },
  error: {
    ...typography.label,
    color: colors.danger,
    textTransform: 'none',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  actions: { marginTop: spacing.md },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  centerLink: { alignSelf: 'center', marginTop: spacing.md },
  dangerLink: { ...typography.label, color: colors.danger, fontSize: 14 },
  shopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.water,
    backgroundColor: colors.waterPale,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  shopIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopCopy: { flex: 1, gap: 2 },
  shopName: { ...typography.heading, color: colors.waterInk },
  shopMeta: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  waitIcon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  status: { minHeight: 40, justifyContent: 'center', marginVertical: spacing.sm },
});
