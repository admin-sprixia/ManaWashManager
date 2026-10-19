import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  ALL_BRANCH_SERVICES,
  branchServicesProblem,
  isValidPhone,
  isValidPincode,
  normalizePhone,
  normalizePincode,
  type BranchCheckKind,
  type BranchServices,
} from '@mana/domain';
import {
  Button,
  IconAlert,
  IconCheck,
  IconMapPin,
  IconStore,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  radius,
  shadow,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { Point } from '../../utils/location';
import { sendInvite } from '../../utils/teamInvite';
import { LocationPicker } from '../places/communityParts';
import { AgreementServices } from '../../components/AgreementServices';
import { failure, useCatalog } from './shared';
import { useApiData } from '../places/shared';
import { PlanList, type PlanItem } from './branch/PlanList';
import { ServiceSwitchList } from './branch/ServiceSwitchList';
import { VehicleKindsList } from './branch/VehicleKindsList';

type Props = NativeStackScreenProps<RootStackParamList, 'OpenBranch'>;
type Pincode = InferResponseType<(typeof api)['business']['pincodes'][':pincode']['$get'], 200>;
type Plan = InferResponseType<
  (typeof api)['business']['branches']['preview']['$post'],
  200
>['plan'];

const CHECK_TITLE: Record<BranchCheckKind, string> = {
  near_branch: 'A branch is right next to this pin',
  far_from_pincode: 'The pin is far from the pincode',
  new_state: 'A new state',
  similar_town: 'A town with a similar name',
};

const STEPS = [
  'Where it is',
  'The branch',
  'Services in the agreement',
  'Services and plans it sells',
  'Vehicles it washes',
  'Its owner',
] as const;

/** Undefined = let the server choose; null = no area. */
type AreaPick = string | null | undefined;

/**
 * Opening a branch: HQ gives the pincode and pins the branch; the server works out the town, its
 * code, the branch number and name, and what to check. Nothing here is typed by hand except the
 * owner. What's shown is a preview; the server decides again when the branch is opened.
 */
export function OpenBranchScreen({ navigation }: Props) {
  const [pincodeText, setPincodeText] = useState('');
  const [place, setPlace] = useState<Pincode | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [pin, setPin] = useState<Point | null>(null);
  const [town, setTown] = useState<string | null>(null);
  const [area, setArea] = useState<AreaPick>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<BranchCheckKind>>(new Set());
  const [services, setServices] = useState<BranchServices>(ALL_BRANCH_SERVICES);
  /** Head-office services it sells from the start; more can be switched on from its page later. */
  const [menu, setMenu] = useState<string[]>([]);
  const { catalog } = useCatalog();
  const hqServices = catalog?.services.filter((s) => s.active) ?? [];
  /** The kinds of vehicle it washes: cars and two-wheelers to start with. */
  const [vehicles, setVehicles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!catalog || vehicles != null) return;
    const start = new Set(
      catalog.classes.filter((c) => c.key === 'car' || c.key === 'twoWheeler').map((c) => c.id),
    );
    setVehicles(catalog.bodyTypes.filter((b) => start.has(b.classId)).map((b) => b.id));
  }, [catalog, vehicles]);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planSeq = useRef(0);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const plans = useApiData<{ plans: PlanItem[] }>(
    () => api.business.plans.$get(),
    'Couldn’t load the wash plans.',
  );

  const pincode = normalizePincode(pincodeText);

  // The pincode, as soon as it's 6 digits: its district and state, and where the map opens.
  useEffect(() => {
    setPlace(null);
    setPlaceError(null);
    setTown(null);
    setArea(undefined);
    if (!isValidPincode(pincode)) {
      if (pincode.length === 6) setPlaceError('A pincode doesn’t start with 0.');
      return;
    }
    let alive = true;
    setPlaceBusy(true);
    void (async () => {
      try {
        const res = await api.business.pincodes[':pincode'].$get({ param: { pincode } });
        if (!alive) return;
        if (!res.ok) setPlaceError(await apiErrorMessage(res, 'Couldn’t look up the pincode.'));
        else setPlace(await res.json());
      } catch (e) {
        if (alive) setPlaceError(failure(e));
      } finally {
        if (alive) setPlaceBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pincode]);

  // The preview, whenever the pincode, the pin or a choice changes.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!place || !pin) return;
    const seq = ++planSeq.current;
    setPlanBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.business.branches.preview.$post({
            json: {
              pincode: place.pincode,
              latitude: pin.latitude,
              longitude: pin.longitude,
              town,
              ...(area === undefined ? {} : { area }),
            },
          });
          if (seq !== planSeq.current) return;
          if (!res.ok) setPlanError(await apiErrorMessage(res, 'Couldn’t work out the branch.'));
          else setPlan((await res.json()).plan);
        } catch (e) {
          if (seq === planSeq.current) setPlanError(failure(e));
        } finally {
          if (seq === planSeq.current) setPlanBusy(false);
        }
      })();
    }, 350);
    return () => clearTimeout(timer);
  }, [place, pin, town, area]);

  // A check HQ accepted stays accepted only while it's still shown.
  useEffect(() => {
    if (!plan) return;
    setConfirmed((prev) => new Set([...prev].filter((k) => plan.checks.some((c) => c.kind === k))));
  }, [plan]);

  const toggleCheck = (kind: BranchCheckKind) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const phone = normalizePhone(ownerPhone);
  const unconfirmed = plan ? plan.checks.filter((c) => !confirmed.has(c.kind)) : [];
  const ready =
    !!plan &&
    !planBusy &&
    unconfirmed.length === 0 &&
    ownerName.trim().length > 0 &&
    isValidPhone(phone) &&
    (vehicles == null || vehicles.length > 0);

  const open = async () => {
    if (!plan || !pin || !place) return;
    if (!ownerName.trim()) return setError('Enter the owner’s name.');
    if (!isValidPhone(phone)) return setError('Enter the owner’s 10-digit mobile number.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.business.branches.$post({
        json: {
          pincode: place.pincode,
          latitude: pin.latitude,
          longitude: pin.longitude,
          town: plan.town.name,
          area: plan.area,
          ownerName: ownerName.trim(),
          ownerPhone: phone,
          confirmed: [...confirmed],
          services,
          menu,
          ...(vehicles ? { vehicles } : {}),
        },
      });
      if (res.status === 201) {
        const opened = (await res.json()) as { id: string; code: string; name: string; owner?: { name: string; hasPin: boolean } };
        const owner = { name: opened.owner?.name ?? ownerName.trim(), phone, role: 'owner' as const, hasPin: opened.owner?.hasPin ?? false };
        showAlert(
          `${opened.name} is open`,
          `Branch code ${opened.code}. Send ${owner.name} the invite on WhatsApp so they can install the app and sign in.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Send invite', onPress: () => void sendInvite(owner, opened.name) },
          ],
        );
        navigation.replace('BusinessBranch', { branchId: opened.id });
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        plan?: Plan;
      } | null;
      if (body?.error === 'needs_confirmation' && body.plan) {
        // Something changed since the preview (another branch opened nearby, say): show it again.
        setPlan(body.plan);
        setError('Something changed since the preview. Look at the checks again, then open.');
      } else {
        setError(body?.message ?? 'Couldn’t open the branch.');
      }
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const runs: BranchServices = services;
  const nameOf = (id: string) => hqServices.find((x) => x.id === id);
  /** Switching a combo on brings the services it bundles. */
  const toggleService = (id: string, on: boolean) =>
    setMenu((prev) =>
      on
        ? [...new Set([...prev, id, ...(nameOf(id)?.includes ?? [])])]
        : prev.filter((x) => x !== id),
    );
  const plansSold = (plans.data?.plans ?? []).filter(
    (p) =>
      p.active &&
      runs.community &&
      menu.includes(p.catalogServiceId) &&
      (!p.upgradeServiceId || menu.includes(p.upgradeServiceId)),
  ).length;

  const agreementProblem = branchServicesProblem(services);
  const canNext = [
    !!place && !!pin && !!plan && !planBusy,
    !!plan && !planBusy && unconfirmed.length === 0,
    agreementProblem == null,
    true,
    vehicles != null && vehicles.length > 0,
    ready,
  ][step]!;
  const blockedBy = [
    !place
      ? 'Enter the pincode.'
      : !pin
        ? 'Pin the branch on the map.'
        : planBusy || !plan
          ? 'Working out the branch…'
          : null,
    unconfirmed.length
      ? `Look at the ${unconfirmed.length === 1 ? 'check' : `${unconfirmed.length} checks`} first.`
      : null,
    agreementProblem,
    null,
    'Pick at least one kind of vehicle.',
    !ownerName.trim()
      ? 'Enter the owner’s name.'
      : !isValidPhone(phone)
        ? 'Enter the owner’s 10-digit mobile number.'
        : null,
  ][step];

  const go = (next: number) => {
    setError(null);
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  // The phone's back button goes back a step; on the first step it leaves.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (step === 0 || busy || e.data.action.type === 'REPLACE') return;
        e.preventDefault();
        go(step - 1);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, step, busy],
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Open a branch"
          onBack={() => (step > 0 ? go(step - 1) : navigation.goBack())}
        />
      </View>
      <View style={styles.progressWrap}>
        <View style={styles.progress}>
          {STEPS.map((t, i) => (
            <View key={t} style={[styles.progressBar, i <= step && styles.progressBarOn]} />
          ))}
        </View>
        <Text style={styles.stepEyebrow}>
          Step {step + 1} of {STEPS.length}
        </Text>
        <Text style={styles.stepTitle}>{STEPS[step]}</Text>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 ? (
            <>
              <Text style={styles.lead}>
                Give the pincode and pin the branch. The app works out the town, its code and the
                branch name.
              </Text>
              <View style={styles.card}>
                <TextField
                  label="Pincode"
                  value={pincodeText}
                  onChangeText={(t) => setPincodeText(t.replace(/[^\d ]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={7}
                  placeholder="524137"
                  hint="The branch’s own pincode, as on its address."
                />
                {placeBusy ? <ActivityIndicator color={colors.indigo} /> : null}
                {place ? (
                  <View style={styles.placeRow}>
                    <IconCheck size={16} color={colors.tealDeep} />
                    <Text style={styles.placeText}>
                      {place.district} · {place.state}
                    </Text>
                  </View>
                ) : null}
                {placeError ? <Text style={styles.error}>{placeError}</Text> : null}
                {place ? (
                  <LocationPicker
                    label="Branch location"
                    what="the branch"
                    value={pin}
                    onChange={setPin}
                    start={place.centre}
                  />
                ) : null}
              </View>
              {planError ? <Text style={styles.errorPad}>{planError}</Text> : null}
            </>
          ) : null}

          {step === 1 && plan ? (
            <>
              <View style={[styles.codeCard, shadow('md')]}>
                <Text style={styles.codeEyebrow}>Branch code</Text>
                <Text style={styles.code}>{plan.code}</Text>
                <Text style={styles.codeName}>{plan.name}</Text>
                <View style={styles.codeMetaRow}>
                  <IconMapPin size={14} color="rgba(255,255,255,0.85)" />
                  <Text style={styles.codeMeta}>
                    {plan.town.name} · {plan.district} · {plan.state}
                  </Text>
                </View>
                <View style={styles.codeTag}>
                  <Text style={styles.codeTagText}>
                    {plan.town.existingId || plan.townBranches > 0
                      ? `${plan.town.name} keeps ${plan.town.code} · branch ${plan.townBranches + 1} here`
                      : `New town code ${plan.town.code}, kept for every ${plan.town.name} branch`}
                  </Text>
                </View>
              </View>
              {planBusy ? <ActivityIndicator color={colors.indigo} /> : null}

              {plan.choices.towns.length > 1 ? (
                <View style={styles.card}>
                  <Text style={styles.label}>Town</Text>
                  <View style={styles.chips}>
                    {plan.choices.towns.map((t) => {
                      const on = t.name === plan.town.name;
                      return (
                        <Pressable
                          key={t.name}
                          onPress={() => {
                            setTown(t.name);
                            setArea(undefined);
                          }}
                          style={[styles.chip, on && styles.chipOn]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.name}</Text>
                          {t.code ? (
                            <Text style={[styles.chipCode, on && styles.chipTextOn]}>{t.code}</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.help}>
                    From India Post’s offices nearest the pin. A big city’s areas are its branches.
                  </Text>
                </View>
              ) : null}

              {plan.choices.areas.length ? (
                <View style={styles.card}>
                  <Text style={styles.label}>Area in the name</Text>
                  <View style={styles.chips}>
                    {[null, ...plan.choices.areas].map((a) => {
                      const on = a === plan.area;
                      return (
                        <Pressable
                          key={a ?? 'none'}
                          onPress={() => setArea(a)}
                          style={[styles.chip, on && styles.chipOn]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>
                            {a ?? 'No area'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {plan.checks.length ? (
                <View style={styles.checks}>
                  {plan.checks.map((c) => {
                    const on = confirmed.has(c.kind);
                    return (
                      <View key={c.kind} style={[styles.check, on && styles.checkOn]}>
                        <View style={styles.checkTop}>
                          <IconAlert size={18} color={on ? colors.tealDeep : colors.amberDeep} />
                          <Text style={styles.checkTitle}>{CHECK_TITLE[c.kind]}</Text>
                        </View>
                        <Text style={styles.checkText}>{c.message}</Text>
                        <View style={styles.checkToggle}>
                          <Text style={styles.checkToggleText}>I’ve checked, it’s right</Text>
                          <Switch
                            value={on}
                            onValueChange={() => toggleCheck(c.kind)}
                            trackColor={{ false: colors.border, true: '#99F6E4' }}
                            thumbColor={on ? colors.tealDeep : colors.white}
                            accessibilityLabel={`${CHECK_TITLE[c.kind]}: checked`}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.lead}>No checks to look at: this looks right.</Text>
              )}
            </>
          ) : null}

          {step === 2 ? (
            <View style={styles.servicesPad}>
              <Text style={styles.leadPlain}>
                Where this branch may wash. It opens with all of these switched on; its owner can
                switch them off and on again, never add one.
              </Text>
              <AgreementServices value={services} onChange={setServices} />
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.servicesPad}>
              <Text style={styles.leadPlain}>
                Switch on what it sells. You can change this later from the branch’s page.
              </Text>
              {catalog ? (
                <ServiceSwitchList
                  catalog={catalog}
                  value={menu}
                  runs={runs}
                  onToggle={toggleService}
                  onAll={(on) => setMenu(on ? hqServices.map((x) => x.id) : [])}
                />
              ) : (
                <ActivityIndicator color={colors.indigo} />
              )}
              <Text style={styles.subTitle}>Plans</Text>
              <Text style={styles.leadPlain}>
                A plan is sold where its wash is switched on: at the shop, at communities, or both, as the plan says.
              </Text>
              {plans.data ? (
                <PlanList
                  plans={plans.data.plans}
                  menu={menu}
                  runs={runs}
                  onSell={(ids) => setMenu((prev) => [...new Set([...prev, ...ids])])}
                />
              ) : plans.error ? (
                <Text style={styles.error}>{plans.error}</Text>
              ) : (
                <ActivityIndicator color={colors.indigo} />
              )}
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.servicesPad}>
              <Text style={styles.leadPlain}>
                Switch on what it washes, by size. Cars and two-wheelers are on to start with. Each
                kind’s size is in the vehicle size guide.
              </Text>
              {catalog && vehicles ? (
                <VehicleKindsList
                  catalog={catalog}
                  value={vehicles}
                  onChange={(next) => setVehicles(next)}
                />
              ) : (
                <ActivityIndicator color={colors.indigo} />
              )}
            </View>
          ) : null}

          {step === 5 && plan ? (
            <>
              <View style={styles.card}>
                <TextField
                  label="Owner’s name"
                  placeholder="Ravi Kumar"
                  value={ownerName}
                  onChangeText={setOwnerName}
                  maxLength={60}
                  autoCapitalize="words"
                />
                <TextField
                  label="Owner’s mobile number"
                  placeholder="98765 43210"
                  value={ownerPhone}
                  onChangeText={setOwnerPhone}
                  keyboardType="phone-pad"
                  maxLength={14}
                  hint="Once the branch opens, you send them an invite on WhatsApp."
                />
              </View>
              <View style={styles.summary}>
                <Text style={styles.summaryTitle}>{plan.name}</Text>
                <SummaryRow
                  label="Code"
                  value={`${plan.code} · ${plan.town.name}`}
                  onEdit={() => go(1)}
                />
                <SummaryRow
                  label="Agreement"
                  value={[
                    services.hub && 'Hub',
                    services.community && 'Community',
                    services.doorstep && 'Doorstep',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  onEdit={() => go(2)}
                />
                <SummaryRow
                  label="Services"
                  value={`${menu.length} of ${hqServices.length} · ${plansSold} plans`}
                  onEdit={() => go(3)}
                />
                <SummaryRow
                  label="Vehicles"
                  value={`${vehicles?.length ?? 0} kinds`}
                  onEdit={() => go(4)}
                />
              </View>
            </>
          ) : null}

          {error ? <Text style={styles.errorPad}>{error}</Text> : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        {!canNext && blockedBy ? <Text style={styles.footerNote}>{blockedBy}</Text> : null}
        <View style={styles.footerRow}>
          {step > 0 ? (
            <View style={styles.footerBack}>
              <Button label="Back" variant="secondary" size="lg" onPress={() => go(step - 1)} />
            </View>
          ) : null}
          <View style={styles.flex}>
            {step < STEPS.length - 1 ? (
              <Button label="Next" size="lg" disabled={!canNext} onPress={() => go(step + 1)} />
            ) : (
              <Button
                label={plan ? `Open branch ${plan.code}` : 'Open branch'}
                size="lg"
                icon={<IconStore size={18} color={colors.white} />}
                loading={busy}
                disabled={!ready}
                onPress={() => void open()}
              />
            )}
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>
        {value}
      </Text>
      <Pressable
        onPress={onEdit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Change ${label}`}
      >
        <Text style={styles.summaryEdit}>Change</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  loading: { marginTop: spacing.md },
  bottomPad: { height: 120 },
  card: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.sm + 4,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: { ...typography.label, color: colors.slateDeep, fontWeight: '800' },
  help: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 17,
  },
  error: { ...typography.label, color: colors.danger },
  errorPad: { ...typography.label, color: colors.danger, paddingHorizontal: spacing.md },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  placeText: {
    ...typography.bodyStrong,
    fontSize: 14.5,
    color: colors.tealDeep,
    fontWeight: '800',
  },

  codeCard: {
    marginHorizontal: spacing.md,
    padding: spacing.lg,
    gap: 4,
    borderRadius: radius.xl,
    backgroundColor: colors.indigo,
  },
  codeEyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  code: {
    ...typography.display,
    fontSize: 40,
    lineHeight: 46,
    color: colors.white,
    letterSpacing: 1,
  },
  codeName: { ...typography.heading, fontSize: 20, color: colors.white },
  codeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  codeMeta: { ...typography.label, color: 'rgba(255,255,255,0.85)', flex: 1 },
  codeTag: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  codeTagText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.slateDeep },
  chipCode: { fontSize: 11.5, fontWeight: '800', color: colors.slate, letterSpacing: 0.5 },
  chipTextOn: { color: colors.white },

  checks: { marginHorizontal: spacing.md, gap: spacing.sm },
  check: {
    padding: spacing.md,
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.amberLight,
    backgroundColor: '#FFFBEB',
  },
  checkOn: { borderColor: '#99F6E4', backgroundColor: '#F0FDFA' },
  checkTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkTitle: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: colors.waterInk,
    fontWeight: '800',
    flex: 1,
  },
  checkText: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },
  checkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  checkToggleText: { ...typography.label, color: colors.waterInk, fontWeight: '700' },

  servicesPad: { marginHorizontal: spacing.md, gap: spacing.sm },
  servicesHelp: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 17,
  },
  menuLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleGroup: { gap: 6, marginBottom: spacing.xs },
  vehicleGroupTitle: {
    ...typography.label,
    fontSize: 13.5,
    color: colors.waterInk,
    fontWeight: '800',
  },
  flexText: { flex: 1 },
  menuLink: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.indigo,
    fontWeight: '700',
    letterSpacing: 0,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 6,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow('lg'),
  },
  footerNote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.amberDeep,
    textAlign: 'center',
    letterSpacing: 0,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerBack: { width: 110 },
  progressWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 4 },
  progress: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  progressBarOn: { backgroundColor: colors.indigo },
  stepEyebrow: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  stepTitle: { ...typography.heading, fontSize: 22, color: colors.waterInk, letterSpacing: -0.3 },
  lead: {
    ...typography.body,
    fontSize: 14,
    color: colors.slateDeep,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  leadPlain: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },
  subTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
    marginTop: spacing.md,
  },
  summary: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.indigoPale,
  },
  summaryTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryLabel: {
    width: 84,
    ...typography.label,
    fontSize: 13,
    color: colors.slateDeep,
    fontWeight: '800',
  },
  summaryValue: { flex: 1, ...typography.body, fontSize: 14, color: colors.waterInk },
  summaryEdit: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '800' },
});
