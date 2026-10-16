import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  IconEdit,
  ScreenContainer,
  ScreenHeader,
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
import {
  Band,
  BandRow,
  CatalogHero,
  NameSheet,
  SectionTitle,
  useCatalog,
  type Catalog,
} from './shared';

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
          <View style={styles.centerPad}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const sizeName = (id: string) => catalog.classes.flatMap((c) => c.sizes).find((z) => z.id === id);
  const totalSizes = catalog.classes.reduce((n, c) => n + c.sizes.length, 0);
  const activeKinds = catalog.bodyTypes.filter((b) => b.active).length;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Vehicle sizes" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <CatalogHero
          eyebrow="Business price list"
          title="Vehicle sizes"
          meta="Prices are set per size. Choose which size each kind of vehicle counts as."
          chips={[
            { label: 'Classes', value: catalog.classes.length },
            { label: 'Sizes', value: totalSizes },
            { label: 'Kinds', value: activeKinds },
          ]}
        />

        {catalog.classes.map((cls) => {
          const kinds = catalog.bodyTypes.filter((b) => b.classId === cls.id);
          return (
            <View key={cls.id} style={styles.classBlock}>
              <View style={styles.classHead}>
                <SectionTitle>{cls.name}</SectionTitle>
                <Pressable
                  onPress={() => setRenaming({ kind: 'class', id: cls.id, name: cls.name })}
                  style={({ pressed }) => [styles.renameBtn, pressed && styles.pressed]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${cls.name}`}
                >
                  <IconEdit size={13} color={colors.indigo} />
                  <Text style={styles.renameText}>Rename</Text>
                </Pressable>
              </View>

              <View style={styles.sizeRow}>
                {cls.sizes.map((z) => (
                  <Pressable
                    key={z.id}
                    onPress={() => setRenaming({ kind: 'size', id: z.id, name: z.name })}
                    style={({ pressed }) => [styles.sizeChip, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename size ${z.name}`}
                  >
                    <View style={styles.sizeKey}>
                      <Text style={styles.sizeKeyText}>{z.key}</Text>
                    </View>
                    <Text style={styles.sizeName}>{z.name}</Text>
                    <IconEdit size={12} color={colors.slate} />
                  </Pressable>
                ))}
              </View>

              {kinds.length === 0 ? (
                <Text style={styles.help}>No vehicle kinds in this class yet.</Text>
              ) : (
                <Band>
                  {kinds.map((b, i) => {
                    const size = sizeName(b.sizeId);
                    return (
                      <BandRow
                        key={b.id}
                        icon={<Image source={vehicleImageFor(b.name)} style={styles.thumb} resizeMode="cover" />}
                        iconBg="transparent"
                        title={b.name}
                        subtitle={size ? `Priced as ${size.name}` : undefined}
                        muted={!b.active}
                        last={i === kinds.length - 1}
                        right={
                          b.active ? (
                            <View style={styles.keyPill}>
                              <Text style={styles.keyPillText}>{size?.key ?? '?'}</Text>
                            </View>
                          ) : (
                            <View style={styles.offPill}>
                              <Text style={styles.offPillText}>Off</Text>
                            </View>
                          )
                        }
                        onPress={() => setBody(b)}
                      />
                    );
                  })}
                </Band>
              )}
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
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 13.5, lineHeight: 19, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
  classBlock: { gap: spacing.sm },
  classHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },
  renameBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  renameText: { ...typography.label, color: colors.indigo, fontWeight: '700', fontSize: 13 },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md },
  sizeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  sizeKey: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeKeyText: { ...typography.label, fontWeight: '800', color: colors.indigo, fontSize: 12 },
  sizeName: { ...typography.label, color: colors.waterInk, fontWeight: '700' },
  thumb: { width: 42, height: 32, borderRadius: 8, backgroundColor: colors.waterMidnight },
  keyPill: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.indigoPale,
    justifyContent: 'center',
  },
  keyPillText: { ...typography.caption, fontSize: 11, color: colors.indigo, fontWeight: '800', letterSpacing: 0 },
  offPill: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
  },
  offPillText: { ...typography.caption, fontSize: 11, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0 },
});
