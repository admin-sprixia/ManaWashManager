import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgeRow,
  IconEdit,
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
import { CATALOG_NAME_MAX } from '@mana/domain';
import { api } from '../../api/client';
import { vehicleImageFor } from '../../components/VehicleTypeIcon';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { NameSheet, useCatalog, type Catalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessVehicles'>;
type BodyType = Catalog['bodyTypes'][number];
type Renaming = { kind: 'class' | 'size'; id: string; name: string };

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * Vehicle classes and their price sizes, and which size each kind of vehicle is priced as. A
 * branch gets a vehicle type for every kind it washes whose size has prices.
 */
export function VehicleSizesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [body, setBody] = useState<BodyType | null>(null);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Vehicle sizes" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const sizeName = (id: string) => catalog.classes.flatMap((c) => c.sizes).find((z) => z.id === id);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Vehicle sizes" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.help, styles.pad]}>
          Prices are set per size. Here you choose which size each kind of vehicle counts as — say a compact SUV priced as
          Large. Branches pick these up on their own.
        </Text>
        {catalog.classes.map((cls) => {
          const kinds = catalog.bodyTypes.filter((b) => b.classId === cls.id);
          return (
            <View key={cls.id}>
              <SectionLabel
                right={
                  <Pressable
                    onPress={() => setRenaming({ kind: 'class', id: cls.id, name: cls.name })}
                    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${cls.name}`}
                  >
                    <IconEdit size={14} color={colors.water} />
                    <Text style={styles.linkText}>Rename</Text>
                  </Pressable>
                }
              >
                {cls.name}
              </SectionLabel>
              <View style={[styles.pad, styles.sizes]}>
                {cls.sizes.map((z) => (
                  <Pressable
                    key={z.id}
                    onPress={() => setRenaming({ kind: 'size', id: z.id, name: z.name })}
                    style={({ pressed }) => [styles.sizeChip, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename size ${z.name}`}
                  >
                    <Text style={styles.sizeKey}>{z.key}</Text>
                    <Text style={styles.sizeName}>{z.name}</Text>
                    <IconEdit size={12} color={colors.slate} />
                  </Pressable>
                ))}
              </View>
              <EdgeGroup>
                {kinds.map((b) => {
                  const size = sizeName(b.sizeId);
                  return (
                    <EdgeRow
                      key={b.id}
                      icon={<Image source={vehicleImageFor(b.name)} style={styles.thumb} resizeMode="cover" />}
                      iconBg="transparent"
                      title={b.name}
                      subtitle={size ? `Priced as ${size.name}` : undefined}
                      tone={b.active ? 'default' : 'muted'}
                      right={b.active ? <Pill label={size?.key ?? '?'} tone="water" /> : <Pill label="OFF" tone="slate" />}
                      onPress={() => setBody(b)}
                    />
                  );
                })}
              </EdgeGroup>
            </View>
          );
        })}
        <View style={styles.bottomPad} />
      </ScrollView>

      <NameSheet
        visible={renaming != null}
        title={renaming?.kind === 'class' ? 'Rename vehicle class' : 'Rename size'}
        label="Name"
        initial={renaming?.name ?? ''}
        maxLength={CATALOG_NAME_MAX}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming) return null;
          const { id, kind } = renaming;
          const message = await run(
            () =>
              kind === 'class'
                ? api.business.classes[':id'].$patch({ param: { id }, json: { name } })
                : api.business.sizes[':id'].$patch({ param: { id }, json: { name } }),
            'Renamed',
          );
          if (!message) setRenaming(null);
          return message;
        }}
      />
      <BodyTypeSheet
        catalog={catalog}
        body={body}
        onClose={() => setBody(null)}
        onSave={async (values) => {
          if (!body) return null;
          const message = await run(
            () => api.business['body-types'][':id'].$patch({ param: { id: body.id }, json: values }),
            'Saved · every branch updated',
          );
          if (!message) setBody(null);
          return message;
        }}
      />
    </ScreenContainer>
  );
}

function BodyTypeSheet({
  catalog,
  body,
  onClose,
  onSave,
}: {
  catalog: Catalog;
  body: BodyType | null;
  onClose: () => void;
  onSave: (values: { name: string; sizeId: string; active: boolean }) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [active, setActive] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!body) return;
    setName(body.name);
    setSizeId(body.sizeId);
    setActive(body.active ? 'yes' : 'no');
    setError(null);
    setBusy(false);
  }, [body]);

  const sizes = catalog.classes.find((c) => c.id === body?.classId)?.sizes ?? [];

  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    setError(null);
    const message = await onSave({ name: name.trim(), sizeId, active: active === 'yes' });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={body != null}
      onClose={onClose}
      dismissable={!busy}
      title={body?.name ?? ''}
      subtitle="Every branch prices this kind of vehicle by the size you pick"
      footer={<Button label="Save" size="lg" loading={busy} onPress={() => void save()} />}
    >
      <TextField label="Name" value={name} onChangeText={setName} maxLength={CATALOG_NAME_MAX} autoCapitalize="words" />
      <ChoiceChips label="Priced as" options={sizes.map((z) => ({ value: z.id, label: z.name }))} value={sizeId} onChange={setSizeId} />
      <ChoiceChips label="Branches wash it" options={YES_NO} value={active} onChange={setActive} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { ...typography.label, color: colors.water, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  sizeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  sizeKey: { ...typography.label, fontWeight: '800', color: colors.waterDeep },
  sizeName: { ...typography.label, color: colors.waterInk },
  thumb: { width: 48, height: 36, borderRadius: radius.sm, backgroundColor: colors.waterMidnight },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
