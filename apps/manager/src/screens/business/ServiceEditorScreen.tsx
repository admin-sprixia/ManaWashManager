import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CATALOG_SERVICE_DESCRIPTION_MAX,
  CATALOG_SERVICE_NAME_MAX,
  SERVICE_CHECKLIST_ITEM_MAX,
  SERVICE_CHECKLIST_MAX,
  SERVICE_DURATION_MAX_MIN,
  SERVICE_KIND_LABEL,
  SERVICE_KINDS,
  DURATION_UNIT_LABEL,
  DURATION_UNIT_MINUTES,
  durationParts,
  formatDuration,
  splitChecklist,
  type DurationUnit,
  servicePlacesLabel,
  type ServiceKind,
  type ServicePlaces,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconPlus,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  showAlert,
  radius,
  shadow,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import { formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { failure, ToggleChips, useCatalog, type Catalog, type CatalogService } from './shared';
import { classesOn, groupServices, orderAfterMove, startingPrice } from './servicesShared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessServiceEdit'>;

const PLACES: { key: keyof ServicePlaces; label: string; explain: string }[] = [
  { key: 'shop', label: 'Shop', explain: 'at the branch' },
  { key: 'community', label: 'Community', explain: 'on community wash days' },
  { key: 'doorstep', label: 'Doorstep', explain: 'at the customer’s home' },
];
/**
 * Add or edit a business service: what it is, where it's done, for which vehicles, a combo, its
 * time, checklist and how it shows. Prices are set in Base prices, and a service is sold only at
 * the branches HQ switches it on for.
 */
export function ServiceEditorScreen({ navigation, route }: Props) {
  const { catalog, error: loadError, load } = useCatalog();
  const serviceId = route.params?.serviceId ?? null;
  const service = catalog?.services.find((s) => s.id === serviceId) ?? null;

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={serviceId ? 'Edit service' : 'New service'} onBack={() => navigation.goBack()} />
        </View>
        {loadError ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{loadError}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }
  return <Editor key={serviceId ?? 'new'} catalog={catalog} service={service} reload={load} navigation={navigation} />;
}

function Editor({
  catalog,
  service,
  reload,
  navigation,
}: {
  catalog: Catalog;
  service: CatalogService | null;
  reload: () => Promise<void>;
  navigation: Props['navigation'];
}) {
  const on = useMemo(() => classesOn(catalog), [catalog]);

  const [name, setName] = useState(service?.name ?? '');
  const [kind, setKind] = useState<ServiceKind>(service?.kind ?? 'wash');
  const [note, setNote] = useState(service?.description ?? '');
  const [places, setPlaces] = useState<ServicePlaces>(service?.places ?? { shop: true, community: true, doorstep: true });
  const [classIds, setClassIds] = useState<string[]>(() => {
    if (service) return service.classIds;
    const first = catalog.classes.find((c) => c.category === 'car' && on.has(c.id)) ?? catalog.classes.find((c) => on.has(c.id));
    return first ? [first.id] : [];
  });
  /** Sizes of a class that have vehicles in them (a size nobody's vehicle is in starts off). */
  const usedSizes = (classId: string) => {
    const cls = catalog.classes.find((c) => c.id === classId);
    const used = (cls?.sizes ?? []).filter((z) => catalog.bodyTypes.some((b) => b.sizeId === z.id && b.active)).map((z) => z.id);
    return used.length ? used : (cls?.sizes ?? []).map((z) => z.id);
  };
  const [sizeIds, setSizeIds] = useState<string[]>(() => service?.sizeIds ?? classIds.flatMap(usedSizes));
  /** Picking a kind of vehicle brings its sizes that have vehicles; dropping one drops its sizes. */
  const pickClasses = (next: string[]) => {
    const added = next.filter((id) => !classIds.includes(id));
    const keep = new Set(catalog.classes.filter((c) => next.includes(c.id)).flatMap((c) => c.sizes.map((z) => z.id)));
    setSizeIds([...sizeIds.filter((id) => keep.has(id)), ...added.flatMap(usedSizes)]);
    setClassIds(next);
  };
  const [isCombo, setIsCombo] = useState((service?.includes.length ?? 0) > 0);
  const [includes, setIncludes] = useState<string[]>(service?.includes ?? []);
  // Time as an amount in a unit (45 minutes, 2 hours, 3 days); stored in minutes.
  const [durationText, setDurationText] = useState(service?.durationMin ? String(durationParts(service.durationMin).amount) : '');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(service?.durationMin ? durationParts(service.durationMin).unit : 'min');
  const [checklist, setChecklist] = useState<string[]>(service?.checklist ?? []);
  const [draft, setDraft] = useState('');
  const [popular, setPopular] = useState(service?.popular ?? false);
  const [showInApp, setShowInApp] = useState(service?.showInApp ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [name, places, classIds, sizeIds, includes, durationText, durationUnit]);

  const team = places.community || places.doorstep;
  const placesLabel = places.shop || team ? servicePlacesLabel(places) : 'Tick at least one';
  const pickedClasses = catalog.classes.filter((c) => classIds.includes(c.id));
  const vehicleOptions = catalog.classes
    .filter((c) => on.has(c.id) || classIds.includes(c.id))
    .map((c) => ({ value: c.id, label: on.has(c.id) ? c.name : `${c.name} (switched off)` }));
  const offNames = catalog.classes.filter((c) => !on.has(c.id) && !classIds.includes(c.id)).map((c) => c.name);

  const isBundled = service != null && catalog.services.some((s) => s.active && s.includes.includes(service.id));
  const bundleable = catalog.services.filter(
    (s) => s.active && s.id !== service?.id && s.includes.length === 0 && s.classIds.some((id) => classIds.includes(id)),
  );
  const picked = includes.filter((id) => bundleable.some((s) => s.id === id));

  const amount = Number(durationText.replace(',', '.'));
  const minutes = durationText.trim() && Number.isFinite(amount) ? Math.round(amount * DURATION_UNIT_MINUTES[durationUnit]) : null;
  const stepDuration = (by: 1 | -1) => {
    const next = Math.max(0, (Number.isFinite(amount) ? amount : 0) + by * (durationUnit === 'min' ? 5 : 1));
    setDurationText(next ? String(next) : '');
  };

  /** Lines of text before a comma become chips; what's after the last comma stays being typed. */
  const typeChecklist = (text: string) => {
    if (!/[,\n]/.test(text)) return setDraft(text);
    const parts = text.split(/[,\n]/);
    const rest = parts.pop() ?? '';
    addLines(parts.join(','));
    setDraft(rest.trimStart());
  };
  const addLines = (text: string) => {
    const lines = splitChecklist(text).map((l) => l.slice(0, SERVICE_CHECKLIST_ITEM_MAX));
    setChecklist((now) => {
      const next = [...now];
      for (const l of lines) {
        if (next.length >= SERVICE_CHECKLIST_MAX) break;
        if (!next.some((x) => x.toLowerCase() === l.toLowerCase())) next.push(l);
      }
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) return setError('Enter the service name.');
    if (!places.shop && !team) return setError('Tick where it’s done: shop, community or doorstep.');
    if (!classIds.length) return setError('Pick at least one kind of vehicle.');
    if (isCombo && picked.length < 2) return setError('A combo needs at least two services. Pick two or more, or switch combo off.');
    if (durationText.trim() && (minutes == null || minutes < 1)) return setError('Enter how long it takes, or leave the time empty.');
    if (minutes != null && minutes > SERVICE_DURATION_MAX_MIN) return setError('That’s more than 30 days.');
    // Whatever is still being typed in What's included counts too.
    const lines = draft.trim() ? [...checklist, ...splitChecklist(draft)].slice(0, SERVICE_CHECKLIST_MAX) : checklist;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: note.trim() || null,
      places,
      classIds,
      sizeIds,
      includes: isBundled || !isCombo ? [] : picked,
      kind,
      durationMin: minutes,
      popular,
      showInApp,
      checklist: lines,
    };
    try {
      const res = service
        ? await api.business.services[':id'].$patch({ param: { id: service.id }, json: body })
        : await api.business.services.$post({ json: body });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save that.'));
        return;
      }
      showToast(service ? 'Service saved' : 'Service added. Give it prices in Base prices, then switch it on at a branch.', 'success');
      navigation.goBack();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!service) return;
    showAlert(`Delete ${service.name}?`, 'It comes off every branch’s menu. Past washes keep its name. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api.business.services[':id'].$delete({ param: { id: service.id } });
              if (!res.ok) {
                setError(await apiErrorMessage(res, 'Couldn’t delete it.'));
                return;
              }
              showToast(`${service.name} deleted`, 'success');
              navigation.goBack();
            } catch (e) {
              setError(failure(e));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const move = async (by: -1 | 1) => {
    if (!service) return;
    const ids = orderAfterMove(catalog, service.id, by);
    if (!ids) return;
    try {
      const res = await api.business.services.order.$put({ json: { ids } });
      if (!res.ok) setError(await apiErrorMessage(res, 'Couldn’t move it.'));
      else await reload();
    } catch (e) {
      setError(failure(e));
    }
  };
  const group = service?.active ? groupServices(catalog, catalog.services.filter((s) => s.active)).find((g) => g.items.some((s) => s.id === service.id)) : undefined;
  const position = group && service ? group.items.findIndex((s) => s.id === service.id) : -1;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={service ? service.name : 'New service'} onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* 1 · The basics */}
        <Card title="The basics">
          <TextField label="Name" placeholder="Basic Wash" value={name} onChangeText={setName} maxLength={CATALOG_SERVICE_NAME_MAX} autoCapitalize="words" />
          <ChoiceChips<ServiceKind>
            label="Kind"
            options={SERVICE_KINDS.map((k) => ({ value: k, label: SERVICE_KIND_LABEL[k] }))}
            value={kind}
            onChange={setKind}
          />
          <TextField
            label="Short note"
            optional
            placeholder="Our most popular wash"
            value={note}
            onChangeText={setNote}
            maxLength={CATALOG_SERVICE_DESCRIPTION_MAX}
          />
        </Card>

        {/* 2 · Where it's done */}
        <Card title="Where it’s done" badge={placesLabel} badgeWarn={!places.shop && !team}>
          <View style={styles.placeRow}>
            {PLACES.map((p) => {
              const ticked = places[p.key];
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPlaces({ ...places, [p.key]: !ticked })}
                  style={({ pressed }) => [styles.placeCard, ticked && styles.placeCardOn, pressed && styles.pressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked }}
                >
                  <View style={[styles.tick, ticked && styles.tickOn]}>{ticked ? <IconCheck size={12} color={colors.white} /> : null}</View>
                  <Text style={[styles.placeLabel, ticked && styles.placeLabelOn]}>{p.label}</Text>
                  <Text style={styles.placeHint}>{p.explain}</Text>
                </Pressable>
              );
            })}
          </View>
          {team ? (
            <Text style={styles.help}>
              One price in Base prices, the hub’s. A community pays it less the community rule; a home adds the visit charge.
            </Text>
          ) : null}
        </Card>

        {/* 3 · Vehicles */}
        <Card title="Vehicles">
          <ToggleChips
            label="For which vehicles"
            options={vehicleOptions}
            value={classIds}
            onChange={pickClasses}
            min={1}
            hint={offNames.length ? `${offNames.join(', ')} ${offNames.length === 1 ? 'is' : 'are'} switched off in Vehicles we wash.` : undefined}
          />
          {pickedClasses.map((c) => {
            const mine = sizeIds.filter((id) => c.sizes.some((z) => z.id === id));
            // Sizes no vehicle is in (a bike "Large") aren't offered, unless this service already has one.
            const shown = c.sizes.filter((z) => mine.includes(z.id) || catalog.bodyTypes.some((b) => b.sizeId === z.id && b.active));
            return (
              <ToggleChips
                key={c.id}
                label={`${c.name} sizes`}
                // Bikes go by name (Regular, Premium); cars by letter and name (S · Small).
                options={shown.map((z) => ({ value: z.id, label: c.category === 'bike' ? z.name : `${z.key} · ${z.name}` }))}
                value={mine}
                onChange={(next) => setSizeIds([...sizeIds.filter((id) => !c.sizes.some((z) => z.id === id)), ...next])}
                min={1}
                hint={shown
                  .map((z) => {
                    const kinds = catalog.bodyTypes.filter((b) => b.sizeId === z.id && b.active).map((b) => b.name);
                    return kinds.length ? `${c.category === 'bike' ? z.name : z.key}: ${kinds.join(', ')}` : null;
                  })
                  .filter(Boolean)
                  .join('  ·  ')}
              />
            );
          })}
          <Pressable
            onPress={() => navigation.navigate('VehicleGuide', { category: pickedClasses.some((c) => c.category === 'bike') && !pickedClasses.some((c) => c.category === 'car') ? 'bike' : 'car' })}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.link}>Which size is my vehicle? Open the size guide ›</Text>
          </Pressable>
          <Text style={styles.help}>Base prices asks for a price for each size ticked here, and branches sell only these sizes.</Text>
        </Card>

        {/* 4 · Combo builder */}
        {isBundled ? null : (
          <Card
            title="Combo"
            badge={isCombo ? (picked.length >= 2 ? `${picked.length} services` : 'Pick 2 or more') : undefined}
            badgeWarn={isCombo && picked.length < 2}
            right={
              <Switch
                value={isCombo}
                onValueChange={setIsCombo}
                trackColor={{ true: colors.indigo, false: colors.border }}
                thumbColor={colors.white}
                accessibilityLabel="Sell several services together as one combo"
              />
            }
          >
            <Text style={styles.help}>
              {isCombo
                ? 'Tick the services it bundles. New Wash drops them from the bill when the combo is picked; set its price in Base prices.'
                : 'Sell two or more services together as one: tap the services below to make this a combo.'}
            </Text>
            {bundleable.length < 2 ? (
              <Text style={styles.help}>A combo needs at least two other services for these vehicles. Add them first.</Text>
            ) : (
              <>
                <View style={styles.tiles}>
                  {bundleable.map((s) => {
                    const inIt = isCombo && includes.includes(s.id);
                    const from = startingPrice(catalog, s);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => {
                          // Tapping a service makes this a combo, starting from what was ticked before.
                          if (!isCombo) {
                            setIsCombo(true);
                            setIncludes([...includes.filter((x) => x !== s.id), s.id]);
                            return;
                          }
                          setIncludes(inIt ? includes.filter((x) => x !== s.id) : [...includes, s.id]);
                        }}
                        style={({ pressed }) => [styles.tile, inIt && styles.tileOn, pressed && styles.pressed]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: inIt }}
                      >
                        <View style={[styles.tileTick, inIt && styles.tickOn]}>{inIt ? <IconCheck size={11} color={colors.white} /> : <IconPlus size={11} color={colors.slate} />}</View>
                        <Text style={[styles.tileName, inIt && styles.tileNameOn]} numberOfLines={2}>
                          {s.name}
                        </Text>
                        <Text style={styles.tilePrice}>{from != null ? `from ${formatRupees(from)}` : 'no price'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </Card>
        )}

        {/* 5 · Time and what's included */}
        <Card title="Time and what’s included">
          <Text style={styles.fieldLabel}>How long it takes</Text>
          <View style={styles.timeRow}>
            <Pressable onPress={() => stepDuration(-1)} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]} accessibilityLabel="Less time" hitSlop={6}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <TextInput
              style={styles.timeInput}
              value={durationText}
              onChangeText={(t) => setDurationText(t.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.slate}
              maxLength={5}
              accessibilityLabel={`Time in ${DURATION_UNIT_LABEL[durationUnit].toLowerCase()}`}
            />
            <Pressable onPress={() => stepDuration(1)} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]} accessibilityLabel="More time" hitSlop={6}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
            <View style={styles.unitSegment} accessibilityRole="radiogroup">
              {(Object.keys(DURATION_UNIT_LABEL) as DurationUnit[]).map((u) => {
                const sel = u === durationUnit;
                return (
                  <Pressable
                    key={u}
                    onPress={() => setDurationUnit(u)}
                    style={[styles.unitItem, sel && styles.unitItemOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                  >
                    <Text style={[styles.unitText, sel && styles.unitTextOn]}>{DURATION_UNIT_LABEL[u]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.help}>
            {minutes && minutes > 0
              ? minutes > SERVICE_DURATION_MAX_MIN
                ? 'That’s more than 30 days.'
                : `Takes ${formatDuration(minutes)}.`
              : 'Leave empty if it varies.'}
          </Text>

          <Text style={styles.fieldLabel}>What’s included · {checklist.length}/{SERVICE_CHECKLIST_MAX}</Text>
          <View style={styles.tagBox}>
            {checklist.map((line) => (
              <View key={line} style={styles.tag}>
                <Text style={styles.tagText} numberOfLines={1}>
                  {line}
                </Text>
                <Pressable onPress={() => setChecklist(checklist.filter((x) => x !== line))} hitSlop={8} accessibilityLabel={`Remove ${line}`}>
                  <IconClose size={13} color={colors.indigo} />
                </Pressable>
              </View>
            ))}
            {checklist.length < SERVICE_CHECKLIST_MAX ? (
              <TextInput
                style={styles.tagInput}
                value={draft}
                onChangeText={typeChecklist}
                onSubmitEditing={() => {
                  addLines(draft);
                  setDraft('');
                }}
                onKeyPress={({ nativeEvent }) => {
                  // Backspace in an empty box takes the last chip back to edit it.
                  if (nativeEvent.key === 'Backspace' && !draft && checklist.length) {
                    setDraft(checklist[checklist.length - 1]!);
                    setChecklist(checklist.slice(0, -1));
                  }
                }}
                blurOnSubmit={false}
                placeholder={checklist.length ? 'Add more…' : 'Foam wash, Vacuum, Tyre shine'}
                placeholderTextColor={colors.slate}
                maxLength={200}
                returnKeyType="done"
                accessibilityLabel="What’s included, separated by commas"
              />
            ) : null}
          </View>
          <Text style={styles.help}>Separate with commas: each one becomes a chip. Tap × to remove one.</Text>
        </Card>

        {/* 6 · How it shows */}
        <Card title="How it shows">
          <SwitchRow
            title="Show in the customer app"
            subtitle={showInApp ? 'Customers see it and can book it' : 'Staff sell it; customers don’t see it in the app'}
            value={showInApp}
            onChange={setShowInApp}
          />
          <SwitchRow
            title="Most popular badge"
            subtitle="A small badge in New Wash and the app, to guide the choice"
            value={popular}
            onChange={setPopular}
          />
        </Card>

        {service && group && group.items.length > 1 ? (
          <View style={styles.moveRow}>
            <Text style={styles.moveLabel}>
              Position {position + 1} of {group.items.length} in {group.title}
            </Text>
            <Pressable onPress={() => void move(-1)} disabled={position <= 0} style={({ pressed }) => [styles.moveBtn, position <= 0 && styles.disabled, pressed && styles.pressed]} accessibilityLabel="Move up">
              <View style={styles.flip}>
                <IconChevronDown size={18} color={colors.waterDeep} />
              </View>
            </Pressable>
            <Pressable onPress={() => void move(1)} disabled={position >= group.items.length - 1} style={({ pressed }) => [styles.moveBtn, position >= group.items.length - 1 && styles.disabled, pressed && styles.pressed]} accessibilityLabel="Move down">
              <IconChevronDown size={18} color={colors.waterDeep} />
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footer}>
          <Button label={service ? 'Save' : 'Add service'} size="lg" loading={busy} onPress={() => void save()} />
          {service ? <Button label="Delete service" variant="danger" disabled={busy} onPress={confirmDelete} /> : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Card({
  title,
  badge,
  badgeWarn,
  right,
  children,
}: {
  title: string;
  badge?: string;
  badgeWarn?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, shadow('sm')]}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, styles.flex]}>{title}</Text>
        {badge ? (
          <View style={[styles.badge, badgeWarn && styles.badgeWarn]}>
            <Text style={[styles.badgeText, badgeWarn && styles.badgeTextWarn]}>{badge}</Text>
          </View>
        ) : null}
        {right}
      </View>
      {children}
    </View>
  );
}

function SwitchRow({ title, subtitle, value, onChange }: { title: string; subtitle: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={styles.switchTitle}>{title}</Text>
        <Text style={styles.switchSub}>{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.indigo, false: colors.border }} thumbColor={colors.white} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.indigoPale, alignItems: 'center', justifyContent: 'center' },
  stepText: { ...typography.heading, fontSize: 20, color: colors.indigo, lineHeight: 22 },
  timeInput: {
    ...typography.heading,
    width: 72,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 18,
    color: colors.ink,
    paddingVertical: 0,
  },
  unitSegment: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  unitItem: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, justifyContent: 'center' },
  unitItemOn: { backgroundColor: colors.indigo },
  unitText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0 },
  unitTextOn: { color: colors.white },
  tagBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingLeft: 10,
    paddingRight: 8,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.indigoPale,
  },
  tagText: { ...typography.caption, flexShrink: 1, fontSize: 13, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  tagInput: { ...typography.body, flexGrow: 1, minWidth: 120, fontSize: 14.5, color: colors.ink, paddingVertical: 4 },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.35 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm + 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.heading, fontSize: 17, color: colors.ink, letterSpacing: -0.2 },
  badge: { paddingHorizontal: 10, height: 26, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.indigoPale },
  badgeWarn: { backgroundColor: '#FEE2E2' },
  badgeText: { ...typography.caption, fontSize: 12, color: colors.indigo, fontWeight: '800', letterSpacing: 0 },
  badgeTextWarn: { color: colors.danger },
  help: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 18 },
  link: { ...typography.caption, fontSize: 12.5, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  fieldLabel: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700' },
  error: { ...typography.label, color: colors.danger },
  footer: { gap: spacing.sm },

  placeRow: { flexDirection: 'row', gap: spacing.sm },
  placeCard: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  placeCardOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  placeLabel: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '800' },
  placeLabelOn: { color: colors.indigo },
  placeHint: { ...typography.caption, fontSize: 11, color: colors.slateDeep, letterSpacing: 0 },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },

  classBlock: { gap: 6, paddingTop: spacing.xs },
  classHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  className: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk, fontWeight: '800' },
  priceHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 56 },
  priceHead: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0.3 },
  priceHeadCol: { ...typography.caption, width: 84, fontSize: 11, color: colors.slate, letterSpacing: 0.3, textAlign: 'center' },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  sizeRowOff: { opacity: 0.5 },
  sizeName: { ...typography.bodyStrong, fontSize: 14, color: colors.ink, fontWeight: '700' },
  sizeKinds: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  priceInput: {
    ...typography.bodyStrong,
    width: 84,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 0,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  quickLabel: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, fontWeight: '700' },
  quick: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  quickOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  quickText: { ...typography.caption, fontSize: 12.5, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  quickTextOn: { color: colors.white },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '31%',
    flexGrow: 1,
    minHeight: 84,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  tileOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  tileTick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { ...typography.bodyStrong, fontSize: 13, color: colors.ink, fontWeight: '700' },
  tileNameOn: { color: colors.indigo },
  tilePrice: { ...typography.caption, fontSize: 11, color: colors.slateDeep, letterSpacing: 0 },
  savings: { borderRadius: radius.lg, backgroundColor: '#ECFDF5', padding: spacing.sm + 2, gap: 6 },
  savingsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  savingsSize: { ...typography.bodyStrong, width: 64, fontSize: 13, color: colors.ink, fontWeight: '800' },
  savingsSep: { ...typography.caption, fontSize: 13, color: colors.slateDeep, textDecorationLine: 'line-through', letterSpacing: 0 },
  savingsArrow: { ...typography.caption, fontSize: 13, color: colors.slate },
  savingsCombo: { ...typography.bodyStrong, fontSize: 14, color: colors.tealDeep, fontWeight: '800' },
  savingsSave: { ...typography.caption, fontSize: 12, color: colors.tealDeep, fontWeight: '700', letterSpacing: 0 },
  savingsBad: { color: colors.danger },

  minutesField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    gap: 4,
  },
  minutesInput: { ...typography.bodyStrong, width: 44, fontSize: 13.5, color: colors.ink, paddingVertical: 0, textAlign: 'center' },
  minutesUnit: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  checkText: { ...typography.body, fontSize: 14.5, color: colors.ink },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addInput: {
    ...typography.body,
    flex: 1,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 14.5,
    color: colors.ink,
  },
  addBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.indigo, alignItems: 'center', justifyContent: 'center' },
  idea: { paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: colors.indigoPale, justifyContent: 'center' },
  ideaText: { ...typography.caption, fontSize: 12, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  switchSub: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },

  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  moveLabel: { ...typography.label, color: colors.slateDeep, flex: 1 },
  moveBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.waterPale, alignItems: 'center', justifyContent: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
});
