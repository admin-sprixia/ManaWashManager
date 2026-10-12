import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgeRow,
  IconChevronDown,
  IconPlus,
  IconSparkle,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { CATALOG_SERVICE_DESCRIPTION_MAX, CATALOG_SERVICE_NAME_MAX, type ServiceModes } from '@mana/domain';
import { api } from '../../api/client';
import { Fab } from '../../components/Fab';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { ToggleChips, useCatalog, type Catalog, type CatalogService } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessServices'>;

const modeOptions = (homeWash: boolean): { value: ServiceModes; label: string }[] => {
  const team = homeWash ? 'doorstep' : 'communities';
  return [
    { value: 'both', label: `Shop and ${team}` },
    { value: 'hub', label: 'Shop only' },
    { value: 'doorstep', label: homeWash ? 'Doorstep only' : 'Communities only' },
  ];
};
const modePill = (modes: ServiceModes, homeWash: boolean): string | null =>
  modes === 'hub' ? 'SHOP ONLY' : modes === 'doorstep' ? (homeWash ? 'DOORSTEP ONLY' : 'COMMUNITIES ONLY') : null;

/** The services every branch offers, in the order New Wash and the app list them. */
export function CatalogServicesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [editing, setEditing] = useState<CatalogService | 'new' | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const className = useMemo(() => new Map(catalog?.classes.map((c) => [c.id, c.name]) ?? []), [catalog]);
  const active = catalog?.services.filter((s) => s.active) ?? [];
  const retired = catalog?.services.filter((s) => !s.active) ?? [];

  const move = async (service: CatalogService, by: -1 | 1) => {
    if (!catalog) return;
    const ids = active.map((s) => s.id);
    const at = ids.indexOf(service.id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    return run(() => api.business.services.order.$put({ json: { ids: [...ids, ...retired.map((s) => s.id)] } }));
  };

  const row = (s: CatalogService) => {
    const names = s.includes.map((id) => catalog?.services.find((x) => x.id === id)?.name).filter(Boolean);
    const pill = !s.active ? 'RETIRED' : s.includes.length > 0 ? 'COMBO' : modePill(s.modes, catalog?.homeWash ?? false);
    return (
      <EdgeRow
        key={s.id}
        icon={<IconSparkle size={18} color={s.active ? colors.waterDeep : colors.slate} />}
        title={s.name}
        subtitle={[s.classIds.map((id) => className.get(id)).join(', '), names.length ? names.join(' + ') : null]
          .filter(Boolean)
          .join(' · ')}
        tone={s.active ? 'default' : 'muted'}
        right={pill ? <Pill label={pill} tone={!s.active ? 'slate' : s.includes.length ? 'water' : 'amber'} /> : undefined}
        onPress={() => setEditing(s)}
      />
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Services" onBack={() => navigation.goBack()} />
      </View>
      {!catalog ? (
        error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.help, styles.pad]}>
            Every branch offers these, for the vehicles it washes. Set their prices in Base prices.
          </Text>
          {active.length === 0 ? (
            <View style={styles.pad}>
              <Notice tone="info" title="No services yet">
                Add your first service, or copy a branch’s menu in from the Business price list screen.
              </Notice>
            </View>
          ) : (
            <EdgeGroup>{active.map(row)}</EdgeGroup>
          )}
          {retired.length > 0 ? (
            <>
              <Pressable onPress={() => setShowRetired((v) => !v)} style={styles.retiredToggle} accessibilityRole="button">
                <SectionLabel>{`Retired (${retired.length})`}</SectionLabel>
                <View style={[styles.chevron, showRetired && styles.chevronOpen]}>
                  <IconChevronDown size={16} color={colors.slateDeep} />
                </View>
              </Pressable>
              {showRetired ? <EdgeGroup>{retired.map(row)}</EdgeGroup> : null}
            </>
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
      {catalog ? (
        <Fab label="Add service" icon={<IconPlus size={22} color={colors.white} />} onPress={() => setEditing('new')} bottom={spacing.lg} />
      ) : null}
      {catalog ? (
        <ServiceSheet
          catalog={catalog}
          service={editing === 'new' ? null : editing}
          visible={editing != null}
          position={editing && editing !== 'new' ? active.findIndex((s) => s.id === editing.id) : -1}
          count={active.length}
          onMove={async (by) => {
            if (editing && editing !== 'new') await move(editing, by);
          }}
          onClose={() => setEditing(null)}
          onSave={async (body, id) => {
            const message = await run(
              () => (id ? api.business.services[':id'].$patch({ param: { id }, json: body }) : api.business.services.$post({ json: body })),
              id ? 'Saved · every branch updated' : 'Service added to every branch',
            );
            if (!message) setEditing(null);
            return message;
          }}
        />
      ) : null}
    </ScreenContainer>
  );
}

interface ServiceBody {
  name: string;
  description: string | null;
  modes: ServiceModes;
  classIds: string[];
  includes: string[];
  active?: boolean;
}

function ServiceSheet({
  catalog,
  service,
  visible,
  position,
  count,
  onMove,
  onClose,
  onSave,
}: {
  catalog: Catalog;
  service: CatalogService | null;
  visible: boolean;
  position: number;
  count: number;
  onMove: (by: -1 | 1) => Promise<void>;
  onClose: () => void;
  onSave: (body: ServiceBody, id: string | null) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modes, setModes] = useState<ServiceModes>('both');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [includes, setIncludes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(service?.name ?? '');
    setDescription(service?.description ?? '');
    setModes(service?.modes ?? 'both');
    setClassIds(service?.classIds ?? catalog.classes.filter((c) => c.category === 'car').map((c) => c.id));
    setIncludes(service?.includes ?? []);
    setError(null);
    setBusy(false);
  }, [visible, service, catalog.classes]);

  // A combo bundles plain, active services that share one of its vehicle classes.
  const bundleable = catalog.services.filter(
    (s) => s.active && s.id !== service?.id && s.includes.length === 0 && s.classIds.some((id) => classIds.includes(id)),
  );
  const isBundled = service != null && catalog.services.some((s) => s.active && s.includes.includes(service.id));

  const save = async (active?: boolean) => {
    if (!name.trim()) return setError('Enter the service name.');
    if (classIds.length === 0) return setError('Pick at least one vehicle class.');
    const picked = includes.filter((id) => bundleable.some((s) => s.id === id));
    if (picked.length === 1) return setError('A combo needs at least two services — or none for a plain service.');
    setBusy(true);
    setError(null);
    const message = await onSave(
      {
        name: name.trim(),
        description: description.trim() || null,
        modes,
        classIds,
        includes: isBundled ? [] : picked,
        ...(active === undefined ? {} : { active }),
      },
      service?.id ?? null,
    );
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={service ? service.name : 'New service'}
      subtitle={service ? 'Changes reach every branch' : 'Every branch gets it, priced from Base prices'}
      footer={
        <View style={styles.footer}>
          <Button label={service ? 'Save' : 'Add service'} size="lg" loading={busy} onPress={() => void save()} />
          {service ? (
            <Button
              label={service.active ? 'Retire from every branch' : 'Bring back to every branch'}
              variant={service.active ? 'danger' : 'secondary'}
              disabled={busy}
              onPress={() => void save(!service.active)}
            />
          ) : null}
        </View>
      }
    >
      <TextField
        label="Name"
        placeholder="Full Wash"
        value={name}
        onChangeText={setName}
        maxLength={CATALOG_SERVICE_NAME_MAX}
        autoCapitalize="words"
      />
      <TextField
        label="Description"
        optional
        placeholder="Foam, vacuum, tyres"
        value={description}
        onChangeText={setDescription}
        maxLength={CATALOG_SERVICE_DESCRIPTION_MAX}
      />
      <ChoiceChips<ServiceModes> label="Where it’s done" options={modeOptions(catalog.homeWash)} value={modes} onChange={setModes} />
      <ToggleChips
        label="Vehicle classes"
        options={catalog.classes.map((c) => ({ value: c.id, label: c.name }))}
        value={classIds}
        onChange={setClassIds}
        min={1}
      />
      {isBundled ? (
        <Text style={styles.help}>This service is inside a combo, so it can’t be a combo itself.</Text>
      ) : bundleable.length >= 2 ? (
        <ToggleChips
          label="Combo of (optional)"
          options={bundleable.map((s) => ({ value: s.id, label: s.name }))}
          value={includes}
          onChange={setIncludes}
          hint="Pick two or more to make this a combo; New Wash drops them from the bill when the combo is picked."
        />
      ) : null}
      {service?.active && count > 1 ? (
        <View style={styles.moveRow}>
          <Text style={styles.moveLabel}>
            Position {position + 1} of {count}
          </Text>
          <Pressable
            onPress={() => void onMove(-1)}
            disabled={busy || position <= 0}
            style={({ pressed }) => [styles.moveBtn, (busy || position <= 0) && styles.moveOff, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Move up"
          >
            <View style={styles.flip}>
              <IconChevronDown size={18} color={colors.waterDeep} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => void onMove(1)}
            disabled={busy || position >= count - 1}
            style={({ pressed }) => [styles.moveBtn, (busy || position >= count - 1) && styles.moveOff, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Move down"
          >
            <IconChevronDown size={18} color={colors.waterDeep} />
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  footer: { gap: spacing.xs },
  error: { ...typography.label, color: colors.danger },
  retiredToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: spacing.md },
  chevron: { marginTop: spacing.lg },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  bottomPad: { height: 120 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  moveLabel: { ...typography.label, color: colors.slateDeep, flex: 1 },
  moveBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveOff: { opacity: 0.35 },
  flip: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.7 },
});
