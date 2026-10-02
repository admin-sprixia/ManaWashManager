import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { Service, VehicleCategory, VehicleType } from '@mana/domain';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { formatRupees, parseRupees } from '../utils/format';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { ComboIncludesPicker } from './ComboIncludesPicker';
import { IconCheck, IconDroplet, IconGift, IconSparkle } from './Icons';
import { VehicleTile } from './VehicleTile';
import { vehicleImageFor } from './VehicleTypeIcon';

interface NewServiceSheetProps {
  visible: boolean;
  /** The tab the owner is on; its vehicles are listed first. */
  category: VehicleCategory;
  vehicleTypes: VehicleType[];
  /** Every active service: names are left out of the suggestions, plain ones can go in a combo. */
  services: Service[];
  /** Price of a service for a vehicle (paise), for the combo's "separately" comparison. */
  priceFor: (serviceId: string, vehicleTypeId: string) => number | null;
  onClose: () => void;
  /** Opens the vehicle picker when the shop has no vehicles to tick yet. */
  onPickVehicles: () => void;
  /** Prices in paise. Resolves with an error message, or null when saved. */
  onSave: (input: NewServiceInput) => Promise<string | null>;
}

export interface NewServiceInput {
  name: string;
  description: string;
  /** Services bundled when this is a combo; empty for a single service. */
  includes: string[];
  vehicles: { vehicleTypeId: string; price: number }[];
}

type Kind = 'single' | 'combo';

const FAMILY_LABEL: Record<VehicleCategory, string> = { car: 'Cars & more', bike: 'Two-wheelers' };

const SUGGESTIONS: Record<VehicleCategory, string[]> = {
  car: [
    'Full Wash',
    'Foam Wash',
    'Interior Cleaning',
    'Body Polish',
    'Waxing',
    'Underbody Wash',
    'Engine Bay Clean',
    'Ceramic Coating',
  ],
  bike: ['Bike Wash', 'Foam Wash', 'Chain Clean & Lube', 'Polish', 'Engine Degrease'],
};

const COMBO_SUGGESTIONS = ['Basic Combo', 'Super Combo', 'Premium Combo', 'Full Detailing'];

const EMPTY_STATE_VEHICLES: Record<VehicleCategory, string[]> = {
  car: ['Hatchback', 'SUV', 'Luxury car'],
  bike: ['Scooter', 'Bike', 'Sports bike'],
};

const DESCRIPTION_MAX = 160;
const COLUMNS = 3;
const COMBO_ACCENT = '#7C3AED';
const COMBO_TINT = '#F5F3FF';

function SectionHead({
  title,
  meta,
  done,
  action,
}: {
  title: string;
  meta?: string;
  done?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {done ? (
          <View style={styles.doneDot}>
            <IconCheck size={11} color={colors.white} />
          </View>
        ) : null}
      </View>
      {action ?? (meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null)}
    </View>
  );
}

/** Name a service, pick the vehicles it's for and price each one. New Wash only offers it for those. */
export function NewServiceSheet({
  visible,
  category,
  vehicleTypes,
  services,
  priceFor,
  onClose,
  onPickVehicles,
  onSave,
}: NewServiceSheetProps) {
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - spacing.lg * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS);
  const [kind, setKind] = useState<Kind>('single');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includes, setIncludes] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [samePrice, setSamePrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind('single');
    setName('');
    setDescription('');
    setIncludes([]);
    setPicked({});
    setSamePrice('');
    setBusy(false);
    setError(null);
  }, [visible]);

  const isCombo = kind === 'combo';
  const plainServices = useMemo(() => services.filter((s) => !(s.includes?.length ?? 0)), [services]);

  /** What the included services would cost bought one by one, when all are priced for this vehicle. */
  const separately = (vehicleTypeId: string): number | null => {
    if (!isCombo || includes.length < 2) return null;
    let sum = 0;
    for (const id of includes) {
      const p = priceFor(id, vehicleTypeId);
      if (p == null) return null;
      sum += p;
    }
    return sum;
  };

  const families = useMemo(() => {
    const order: VehicleCategory[] = category === 'bike' ? ['bike', 'car'] : ['car', 'bike'];
    return order
      .map((family) => ({ family, types: vehicleTypes.filter((vt) => vt.category === family) }))
      .filter((f) => f.types.length > 0);
  }, [vehicleTypes, category]);

  const suggestions = useMemo(() => {
    const taken = new Set(services.map((s) => s.name.toLowerCase()));
    return (isCombo ? COMBO_SUGGESTIONS : SUGGESTIONS[category]).filter((s) => !taken.has(s.toLowerCase()));
  }, [category, services, isCombo]);

  const switchKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setName('');
    setError(null);
  };

  const toggle = (id: string) => {
    setError(null);
    setPicked((current) => {
      const next = { ...current };
      if (id in next) delete next[id];
      else next[id] = samePrice;
      return next;
    });
  };

  const setFamily = (types: VehicleType[], on: boolean) =>
    setPicked((current) => {
      const next = { ...current };
      for (const vt of types) {
        if (!on) delete next[vt.id];
        else if (!(vt.id in next)) next[vt.id] = samePrice;
      }
      return next;
    });

  const applySamePrice = () =>
    setPicked((current) => Object.fromEntries(Object.keys(current).map((id) => [id, samePrice])));

  const pickedTypes = vehicleTypes.filter((vt) => vt.id in picked);
  const entries = pickedTypes.map((vt) => ({ vehicleTypeId: vt.id, price: parseRupees(picked[vt.id] ?? '') }));
  const missingPrice = entries.filter((e) => e.price == null || Number.isNaN(e.price)).length;
  const trimmed = name.trim();
  const nameDone = trimmed.length > 0;
  const includesDone = !isCombo || includes.length >= 2;
  const vehiclesDone = pickedTypes.length > 0;
  const pricesDone = vehiclesDone && missingPrice === 0;
  const ready = nameDone && includesDone && pricesDone;
  const samePriceValue = parseRupees(samePrice);
  const samePriceOk = samePriceValue != null && !Number.isNaN(samePriceValue);
  const progress = [nameDone, ...(isCombo ? [includesDone] : []), vehiclesDone, pricesDone];
  const accent = isCombo ? COMBO_ACCENT : colors.water;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const message = await onSave({
      name: trimmed,
      description: description.trim(),
      includes: isCombo ? includes : [],
      vehicles: entries.map((e) => ({ vehicleTypeId: e.vehicleTypeId, price: e.price as number })),
    });
    setBusy(false);
    if (message) setError(message);
  };

  const footerHint = !nameDone
    ? `Give the ${isCombo ? 'combo' : 'service'} a name`
    : !includesDone
      ? 'Tick at least two services to bundle'
      : !vehiclesDone
        ? 'Choose the vehicles it’s for'
        : missingPrice > 0
          ? `${missingPrice} price${missingPrice === 1 ? '' : 's'} left to fill`
          : `Ready for ${pickedTypes.length} vehicle${pickedTypes.length === 1 ? '' : 's'}`;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={isCombo ? 'New combo' : 'New service'}
      subtitle={`For ${FAMILY_LABEL[category]}`}
      footer={
        <View style={styles.footer}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              {progress.map((done, i) => (
                <View key={i} style={[styles.progressSeg, done && { backgroundColor: accent }]} />
              ))}
            </View>
            <Text style={[styles.footerHint, ready && styles.footerHintReady]}>{footerHint}</Text>
          </View>
          <Button
            label={isCombo ? 'Add combo' : 'Add service'}
            size="lg"
            loading={busy}
            disabled={!ready}
            onPress={() => void save()}
          />
        </View>
      }
    >
      {/* Single service or a combo of several */}
      <View style={styles.segment}>
        {(['single', 'combo'] as const).map((k) => {
          const on = kind === k;
          const tint = k === 'combo' ? COMBO_ACCENT : colors.water;
          return (
            <Pressable
              key={k}
              onPress={() => switchKind(k)}
              style={[styles.segmentBtn, on && styles.segmentBtnOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.segmentIcon, { backgroundColor: on ? tint : 'transparent' }]}>
                {k === 'single' ? (
                  <IconDroplet size={15} color={on ? colors.white : colors.slate} />
                ) : (
                  <IconGift size={15} color={on ? colors.white : colors.slate} />
                )}
              </View>
              <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                {k === 'single' ? 'Single service' : 'Combo'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.kindHint}>
        {isCombo
          ? 'Bundle a few services at one special price — like Foam Wash + Interior.'
          : 'One job your team does, like Foam Wash or Polish.'}
      </Text>

      {/* Name + description */}
      <View style={styles.section}>
        <SectionHead title="Details" done={nameDone} />
        <View style={[styles.detailsCard, shadow('sm'), nameDone && { borderColor: accent }]}>
          <Text style={styles.fieldLabel}>{isCombo ? 'COMBO NAME' : 'SERVICE NAME'}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={(t) => {
              setName(t);
              setError(null);
            }}
            placeholder={
              isCombo ? 'e.g. Super Combo' : category === 'bike' ? 'e.g. Chain Clean & Lube' : 'e.g. Ceramic Coating'
            }
            placeholderTextColor={colors.slate}
            maxLength={60}
          />
          <View style={styles.fieldDivider} />
          <Text style={styles.fieldLabel}>DESCRIPTION · OPTIONAL</Text>
          <TextInput
            style={styles.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder={
              isCombo
                ? 'What the customer gets, e.g. Foam wash + full interior vacuum'
                : 'What’s done, e.g. Foam, pressure rinse, tyre shine'
            }
            placeholderTextColor={colors.slate}
            maxLength={DESCRIPTION_MAX}
            multiline
          />
          <Text style={styles.counter}>
            {description.length}/{DESCRIPTION_MAX}
          </Text>
        </View>
        {suggestions.length > 0 ? (
          <View style={styles.quickWrap}>
            <View style={styles.quickLabelRow}>
              <IconSparkle size={13} color={accent} />
              <Text style={styles.quickLabel}>Quick picks</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
              keyboardShouldPersistTaps="handled"
            >
              {suggestions.map((s) => {
                const on = s === trimmed;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setName(on ? '' : s)}
                    style={({ pressed }) => [
                      styles.chip,
                      on && { backgroundColor: accent },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {/* Combo · what's included */}
      {isCombo ? (
        <View style={styles.section}>
          <SectionHead
            title="What’s included"
            done={includesDone}
            meta={plainServices.length >= 2 ? `${includes.length} selected` : undefined}
          />
          <ComboIncludesPicker
            services={plainServices}
            selected={includes}
            onChange={setIncludes}
            onCreateSingle={() => switchKind('single')}
          />
        </View>
      ) : null}

      {/* Vehicles */}
      <View style={styles.section}>
        <SectionHead
          title="Vehicles"
          done={vehiclesDone}
          meta={families.length > 0 ? `${pickedTypes.length} selected` : undefined}
        />
        {families.length === 0 ? (
          <View style={styles.emptyVehicles}>
            <View style={styles.emptyStack}>
              {EMPTY_STATE_VEHICLES[category].map((n, i) => (
                <Image
                  key={n}
                  source={vehicleImageFor(n)}
                  resizeMode="cover"
                  style={[
                    styles.emptyThumb,
                    i === 1 && styles.emptyThumbCenter,
                    i === 0 && styles.emptyThumbLeft,
                    i === 2 && styles.emptyThumbRight,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.emptyTitle}>Add the vehicles you wash</Text>
            <Text style={styles.emptyText}>
              Pick them once with photos — then choose which ones this service is for and set a price for each.
            </Text>
            <Button label="Choose vehicles" onPress={onPickVehicles} />
          </View>
        ) : (
          families.map(({ family, types }) => {
            const allOn = types.every((vt) => vt.id in picked);
            return (
              <View key={family} style={styles.family}>
                <View style={styles.familyHead}>
                  <Text style={styles.familyLabel}>{FAMILY_LABEL[family]}</Text>
                  <Pressable
                    hitSlop={10}
                    onPress={() => setFamily(types, !allOn)}
                    style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
                  >
                    <Text style={styles.selectAllText}>{allOn ? 'Clear' : 'Select all'}</Text>
                  </Pressable>
                </View>
                <View style={styles.grid}>
                  {types.map((vt) => (
                    <VehicleTile
                      key={vt.id}
                      label={vt.name}
                      image={vehicleImageFor(vt.name)}
                      width={tileWidth}
                      selected={vt.id in picked}
                      onPress={() => toggle(vt.id)}
                    />
                  ))}
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Prices */}
      {vehiclesDone ? (
        <View style={styles.section}>
          <SectionHead
            title={isCombo ? 'Combo prices' : 'Prices'}
            done={pricesDone}
            meta={`${pickedTypes.length - missingPrice} of ${pickedTypes.length} set`}
          />
          <View style={[styles.priceCard, shadow('sm')]}>
            {pickedTypes.length > 1 ? (
              <View style={styles.sameRow}>
                <View style={styles.sameInputWrap}>
                  <Text style={styles.sameRupee}>₹</Text>
                  <TextInput
                    style={styles.sameInput}
                    value={samePrice}
                    onChangeText={setSamePrice}
                    keyboardType="numeric"
                    placeholder="Same price for all"
                    placeholderTextColor={colors.slate}
                    maxLength={7}
                  />
                </View>
                <Pressable
                  onPress={applySamePrice}
                  disabled={!samePriceOk}
                  style={({ pressed }) => [
                    styles.applyBtn,
                    { backgroundColor: samePriceOk ? accent : colors.surface },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.applyText, !samePriceOk && styles.applyTextOff]}>Apply</Text>
                </Pressable>
              </View>
            ) : null}
            {pickedTypes.map((vt, i) => {
              const value = picked[vt.id] ?? '';
              const empty = value.trim().length === 0;
              const apart = separately(vt.id);
              const typed = parseRupees(value);
              const saving = apart != null && typed != null && !Number.isNaN(typed) ? apart - typed : null;
              return (
                <View key={vt.id} style={[styles.priceRow, (i > 0 || pickedTypes.length > 1) && styles.priceDivider]}>
                  <Image source={vehicleImageFor(vt.name)} style={styles.priceThumb} resizeMode="cover" />
                  <View style={styles.priceCopy}>
                    <Text style={styles.priceName} numberOfLines={1}>
                      {vt.name}
                    </Text>
                    {apart != null ? (
                      saving != null && saving > 0 ? (
                        <View style={styles.saveTag}>
                          <Text style={styles.saveTagText}>Saves {formatRupees(saving)}</Text>
                        </View>
                      ) : (
                        <Text style={styles.apart}>Separately {formatRupees(apart)}</Text>
                      )
                    ) : empty ? (
                      <Text style={styles.needsPrice}>Add a price</Text>
                    ) : null}
                  </View>
                  <View style={[styles.priceBox, empty && styles.priceBoxEmpty]}>
                    <Text style={styles.priceRupee}>₹</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={value}
                      onChangeText={(t) => setPicked((current) => ({ ...current, [vt.id]: t }))}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.slate}
                      maxLength={7}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.pill,
  },
  segmentBtnOn: { backgroundColor: colors.white, ...shadow('sm') },
  segmentIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  segmentText: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep },
  segmentTextOn: { color: colors.waterInk, fontWeight: '700' },
  kindHint: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.slateDeep,
    letterSpacing: 0,
    textAlign: 'center',
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.md,
  },
  section: { gap: spacing.sm + 4, marginTop: spacing.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  sectionMeta: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0 },
  doneDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsCard: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  fieldLabel: { ...typography.caption, fontSize: 11, color: colors.slate, fontWeight: '700', letterSpacing: 0.8 },
  nameInput: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.waterInk,
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
    letterSpacing: -0.2,
  },
  fieldDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  descInput: {
    minHeight: 48,
    fontSize: 15,
    lineHeight: 21,
    color: colors.waterInk,
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
  },
  counter: { ...typography.caption, fontSize: 11, color: colors.slate, textAlign: 'right', letterSpacing: 0 },
  quickWrap: { gap: spacing.sm },
  quickLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0.3 },
  quickRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipText: { ...typography.label, fontSize: 14, color: colors.waterInk },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  emptyVehicles: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyStack: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 86, marginBottom: 4 },
  emptyThumb: {
    width: 92,
    height: 66,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.waterMidnight,
  },
  emptyThumbLeft: { transform: [{ rotate: '-8deg' }], marginRight: -22 },
  emptyThumbCenter: { width: 104, height: 76, zIndex: 2, ...shadow('md') },
  emptyThumbRight: { transform: [{ rotate: '8deg' }], marginLeft: -22 },
  emptyTitle: { ...typography.bodyStrong, fontSize: 17, color: colors.waterInk, textAlign: 'center' },
  emptyText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.slateDeep,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  family: { gap: spacing.sm + 2 },
  familyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  familyLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  selectAll: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    justifyContent: 'center',
  },
  selectAllText: { ...typography.caption, color: colors.waterDeep, fontWeight: '700', letterSpacing: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.md },
  priceCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  sameRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.sm + 4 },
  sameInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  sameRupee: { ...typography.bodyStrong, color: colors.slateDeep, marginRight: 4 },
  sameInput: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.waterInk, paddingVertical: 0 },
  applyBtn: {
    height: 44,
    paddingHorizontal: spacing.md + 4,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  applyText: { ...typography.label, fontSize: 14, color: colors.white, fontWeight: '700' },
  applyTextOff: { color: colors.slate },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  priceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  priceThumb: { width: 56, height: 42, borderRadius: 12, backgroundColor: colors.waterMidnight },
  priceCopy: { flex: 1, gap: 4, alignItems: 'flex-start' },
  priceName: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  apart: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  needsPrice: { ...typography.caption, color: colors.amberDeep, letterSpacing: 0 },
  saveTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: COMBO_TINT },
  saveTagText: { ...typography.caption, fontSize: 11, color: COMBO_ACCENT, fontWeight: '800', letterSpacing: 0.2 },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 104,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
  },
  priceBoxEmpty: { borderColor: colors.amberLight, backgroundColor: '#FFFBEB' },
  priceRupee: { ...typography.bodyStrong, color: colors.slateDeep, marginRight: 2 },
  priceInput: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.waterInk, paddingVertical: 0 },
  footer: { gap: spacing.sm + 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressTrack: { flexDirection: 'row', gap: 4 },
  progressSeg: { width: 18, height: 5, borderRadius: 3, backgroundColor: colors.border },
  footerHint: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0, flex: 1 },
  footerHintReady: { color: colors.teal, fontWeight: '700' },
  error: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
  },
});
