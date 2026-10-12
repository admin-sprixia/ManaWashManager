import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MAX_VEHICLES_PER_JOIN, PARKING_NOTE_MAX, UNIT_TEXT_MAX, formatDay, formatInr, unitTitle } from '@mana/domain';
import {
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgePanel,
  EdgeRow,
  IconClose,
  IconPlus,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  formatPhone,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { openWhatsApp } from '../../utils/whatsapp';
import { failure, useApiData, type PlaceDetail, type StaffJoin, type StaffMenu } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'AddMember'>;
type Menu = StaffMenu['menu'];
type Choice = { kind: 'plan'; planId: string; payMode: 'full' | 'parts' } | { kind: 'single'; serviceIds: string[] };

interface Draft {
  key: string;
  typeId: string | null;
  /** "plan:<id>" or "svc:<id>". */
  pick: string | null;
  payMode: 'full' | 'parts';
}

const squash = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase();
let nextKey = 0;
const newDraft = (): Draft => ({ key: `d${++nextKey}`, typeId: null, pick: null, payMode: 'full' });

function choiceOf(d: Draft): Choice | null {
  if (!d.pick) return null;
  const [kind, id] = d.pick.split(':') as ['plan' | 'svc', string];
  return kind === 'plan' ? { kind: 'plan', planId: id, payMode: d.payMode } : { kind: 'single', serviceIds: [id] };
}

function pickOptions(menu: Menu, typeId: string) {
  const plans = menu.plans.flatMap((p) => {
    const price = p.prices.find((x) => x.vehicleTypeId === typeId);
    return price ? [{ value: `plan:${p.id}`, label: `${p.name}${p.popular ? ' ★' : ''} · ${formatInr(price.total)}` }] : [];
  });
  const services = menu.services.flatMap((s) => {
    const price = s.prices.find((x) => x.vehicleTypeId === typeId);
    return price ? [{ value: `svc:${s.id}`, label: `${s.name} · ${formatInr(price.price)}` }] : [];
  });
  return { plans, services, any: plans.length + services.length > 0 };
}

/** "1 wash a week · Exterior Wash · ₹150 a wash (save 10%)" for the picked plan. */
function planLine(menu: Menu, planId: string, typeId: string): string | null {
  const plan = menu.plans.find((p) => p.id === planId);
  const price = plan?.prices.find((x) => x.vehicleTypeId === typeId);
  if (!plan || !price) return null;
  const perWeek = plan.perWeek === 1 ? '1 wash a week' : `${plan.perWeek} washes a week`;
  const each = formatInr(Math.round(price.total / plan.washes));
  const save = plan.discountBp > 0 ? ` (save ${plan.discountBp / 100}%)` : '';
  return `${perWeek} · ${plan.washes} ${plan.serviceName} washes · ${each} a wash${save}`;
}

/**
 * Flow E: adding someone at the door who has no smartphone (or asked the team). Their number is
 * proved by a WhatsApp code they read out; then flat, vehicles and plan, and a payment link the
 * team sends them (anyone in the family can pay it).
 */
export function AddMemberScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const detail = useApiData<PlaceDetail>(() => api.places[':id'].$get({ param: { id: placeId } }), 'Couldn’t load this place.');
  const menuData = useApiData<StaffMenu>(() => api.places.menu.$get(), 'Couldn’t load the plans.');
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [flat, setFlat] = useState('');
  const [parking, setParking] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<StaffJoin | null>(null);

  const menu = menuData.data?.menu ?? null;
  const units = useMemo(() => detail.data?.units ?? [], [detail.data]);
  const noun = detail.data?.place.type === 'building' ? 'Flat' : 'House';
  const typeOptions = useMemo(
    () => (menu ? menu.vehicleTypes.filter((t) => pickOptions(menu, t.id).any).map((t) => ({ value: t.id, label: t.name })) : []),
    [menu],
  );
  const matchedUnit = useMemo(() => {
    const typed = squash(flat);
    if (!typed) return null;
    return units.find((u) => squash(`${u.block ?? ''}${u.number}`) === typed) ?? units.find((u) => !u.block && squash(u.number) === typed) ?? null;
  }, [flat, units]);

  useEffect(() => setError(null), [phone, code, flat, drafts]);

  const update = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const sendCode = async () => {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) return setError('Enter their 10-digit mobile number.');
    setBusy('code');
    setError(null);
    try {
      const res = await api.places[':id'].members.code.$post({ param: { id: placeId }, json: { phone: digits } });
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t send the code.'));
      setCodeSent(true);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (!/^\d{4,8}$/.test(code.trim())) return setError('Enter the code they received on WhatsApp.');
    if (!flat.trim()) return setError(`Enter their ${noun.toLowerCase()} number.`);
    const vehicles = drafts.map((d) => ({ typeId: d.typeId, choice: choiceOf(d) }));
    if (vehicles.some((v) => !v.typeId || !v.choice)) return setError('Pick the vehicle and its plan or wash.');
    setBusy('join');
    setError(null);
    try {
      const res = await api.places[':id'].members.$post({
        param: { id: placeId },
        json: {
          phone: phone.replace(/\D/g, '').slice(-10),
          code: code.trim(),
          name: name.trim() || null,
          unit: matchedUnit ? { unitId: matchedUnit.id } : { text: flat.trim() },
          parkingNote: parking.trim() || null,
          vehicles: vehicles.map((v) => ({ vehicleTypeId: v.typeId!, choice: v.choice! })),
        },
      });
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t add them.'));
      setJoined(await res.json());
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const sendLink = async (orderId: string) => {
    setBusy(`link:${orderId}`);
    setError(null);
    try {
      const res = await api.places.orders[':id']['payment-link'].$post({ param: { id: orderId } });
      const body = (await res.json()) as { message?: string; phone?: string | null };
      if (!res.ok || !body.message) setError(body.message ?? 'Couldn’t make the payment link.');
      else await openWhatsApp(body.phone ?? phone, body.message);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  if (joined) {
    const toPay = joined.orders.filter((o) => o.status === 'awaiting_payment');
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Member added" onBack={() => navigation.goBack()} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.pad}>
            <Notice tone="success" title={`${unitTitle(noun, flat)} is in`}>
              {toPay.length
                ? 'Send the payment link on WhatsApp. Washing starts once it’s paid; the list shows Paid.'
                : 'They’re on the place’s list.'}
            </Notice>
          </View>
          <SectionLabel>Orders</SectionLabel>
          <EdgeGroup>
            {joined.orders.map((o) => (
              <EdgeRow
                key={o.id}
                title={`${o.title} · ${formatInr(o.total)}`}
                subtitle={
                  o.firstWashOn
                    ? `First wash ${formatDay(o.firstWashOn)}${o.dueNow < o.total ? ` · ${formatInr(o.dueNow)} now, the rest in parts` : ''}`
                    : 'Waiting list: the place is full'
                }
                right={<Pill label={o.status === 'awaiting_payment' ? 'NOT PAID' : o.status === 'waitlist' ? 'WAITING' : 'OK'} tone={o.status === 'awaiting_payment' ? 'danger' : 'slate'} />}
              />
            ))}
          </EdgeGroup>
          <View style={styles.pad}>
            {toPay.map((o) => (
              <Button
                key={o.id}
                label={toPay.length > 1 ? `Send link · ${o.title}` : 'Send payment link on WhatsApp'}
                size="lg"
                loading={busy === `link:${o.id}`}
                onPress={() => void sendLink(o.id)}
              />
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Done" variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Add a member" onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <SectionLabel>Their number</SectionLabel>
          <EdgePanel style={styles.panel}>
            <TextField
              label="Mobile number"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setCodeSent(false);
              }}
              keyboardType="phone-pad"
              maxLength={14}
              placeholder="98765 43210"
            />
            {codeSent ? (
              <>
                <Text style={styles.help}>A code went to +91 {formatPhone(phone.replace(/\D/g, '').slice(-10))} on WhatsApp. Ask them to read it out.</Text>
                <TextField label="Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={8} />
              </>
            ) : (
              <Button label="Send code on WhatsApp" variant="secondary" loading={busy === 'code'} onPress={() => void sendCode()} />
            )}
          </EdgePanel>

          {codeSent ? (
            <>
              <SectionLabel>Their home</SectionLabel>
              <EdgePanel style={styles.panel}>
                <TextField
                  label={`${noun} number`}
                  value={flat}
                  onChangeText={setFlat}
                  maxLength={UNIT_TEXT_MAX}
                  placeholder={units[0] ? `${units[0].block ?? ''}${units[0].block ? '-' : ''}${units[0].number}` : '101'}
                  autoCapitalize="characters"
                  hint={flat.trim() ? (matchedUnit ? 'On the list.' : 'Not on the list; saved as typed.') : undefined}
                />
                <TextField label="Name" optional value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
                <TextField label="Where it’s parked" optional value={parking} onChangeText={setParking} maxLength={PARKING_NOTE_MAX} />
              </EdgePanel>

              <SectionLabel>Vehicles</SectionLabel>
              {!menu ? (
                <Text style={[styles.help, styles.pad]}>{menuData.error ?? 'Loading plans…'}</Text>
              ) : (
                drafts.map((d, i) => {
                  const options = d.typeId ? pickOptions(menu, d.typeId) : null;
                  const planId = d.pick?.startsWith('plan:') ? d.pick.slice(5) : null;
                  const plan = planId ? menu.plans.find((p) => p.id === planId) : undefined;
                  const line = planId && d.typeId ? planLine(menu, planId, d.typeId) : null;
                  return (
                    <EdgePanel key={d.key} style={[styles.panel, i > 0 && styles.gapTop]}>
                      <View style={styles.vehicleHead}>
                        <Text style={styles.vehicleTitle}>Vehicle {i + 1}</Text>
                        {drafts.length > 1 ? (
                          <Button label="Remove" variant="ghost" icon={<IconClose size={14} color={colors.slate} />} onPress={() => setDrafts((l) => l.filter((x) => x.key !== d.key))} />
                        ) : null}
                      </View>
                      <ChoiceChips label="Type" options={typeOptions} value={d.typeId} onChange={(typeId) => update(d.key, { typeId, pick: null, payMode: 'full' })} />
                      {options?.plans.length ? (
                        <ChoiceChips label="Monthly plan" options={options.plans} value={d.pick} onChange={(pick) => update(d.key, { pick, payMode: 'full' })} />
                      ) : null}
                      {line ? <Text style={styles.planLine}>{line}</Text> : null}
                      {plan?.allowParts ? (
                        <ChoiceChips
                          label="Payment"
                          options={[
                            { value: 'full', label: 'All now' },
                            { value: 'parts', label: 'In parts' },
                          ]}
                          value={d.payMode}
                          onChange={(payMode) => update(d.key, { payMode })}
                        />
                      ) : null}
                      {options?.services.length ? (
                        <ChoiceChips label="Or just one wash" options={options.services} value={d.pick} onChange={(pick) => update(d.key, { pick, payMode: 'full' })} />
                      ) : null}
                    </EdgePanel>
                  );
                })
              )}
              {drafts.length < MAX_VEHICLES_PER_JOIN ? (
                <View style={styles.pad}>
                  <Button label="Add another vehicle" variant="ghost" icon={<IconPlus size={16} color={colors.waterDeep} />} onPress={() => setDrafts((l) => [...l, newDraft()])} />
                </View>
              ) : null}
            </>
          ) : null}

          <View style={styles.pad}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {codeSent ? <Button label="Add member" size="lg" loading={busy === 'join'} onPress={() => void join()} /> : null}
          </View>
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingTop: spacing.sm },
  panel: { gap: spacing.md },
  gapTop: { marginTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  help: { ...typography.body, fontSize: 14, color: colors.slateDeep },
  vehicleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehicleTitle: { ...typography.bodyStrong, color: colors.waterInk },
  planLine: { ...typography.caption, color: colors.waterDeep, marginTop: -spacing.xs },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
