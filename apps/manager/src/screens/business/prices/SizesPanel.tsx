import React, { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, ChoiceChips, IconEdit, TextField, colors, radius, spacing, typography } from '@mana/ui';
import { CATALOG_NAME_MAX } from '@mana/domain';
import { api } from '../../../api/client';
import { NameSheet, type Catalog, type useCatalog } from '../shared';
import { Panel, TONE, partStyles } from './parts';

type Run = ReturnType<typeof useCatalog>['run'];
type BodyType = Catalog['bodyTypes'][number];

/**
 * Which size each kind of vehicle is priced as (a Hatchback is S, an SUV is L): head office's
 * decision, the same at every branch. Tap a kind to move it to another size or rename it; tap a
 * size to rename it. Which kinds a branch washes is set on the branch's page.
 */
export const SizesPanel = memo(function SizesPanel({ catalog, run, classId }: { catalog: Catalog; run: Run; classId: string }) {
  const cls = catalog.classes.find((c) => c.id === classId);
  const kinds = catalog.bodyTypes.filter((b) => b.classId === classId);
  const [body, setBody] = useState<BodyType | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'class' | 'size'; id: string; name: string } | null>(null);
  if (!cls) return null;

  // Every size that has a kind (an empty one, like a bike's L, stays out).
  const sizes = cls.sizes.filter((z) => kinds.some((b) => b.sizeId === z.id));

  return (
    <>
      <Panel
        title={`Which size is each ${cls.name.toLowerCase()}?`}
        subtitle="Every branch charges a kind of vehicle the price of its size. Tap a kind to move it to another size."
        onEdit={() => setRenaming({ kind: 'class', id: cls.id, name: cls.name })}
        editLabel="Rename"
      >
        {sizes.map((z) => (
          <View key={z.id} style={styles.sizeRow}>
            <Pressable
              onPress={() => setRenaming({ kind: 'size', id: z.id, name: z.name })}
              style={({ pressed }) => [styles.sizeHead, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Rename size ${z.name}`}
            >
              <View style={[styles.badge, { backgroundColor: TONE.hub.pale }]}>
                <Text style={[styles.badgeText, { color: TONE.hub.ink }]}>{z.key}</Text>
              </View>
              <Text style={styles.sizeName} numberOfLines={1}>
                {z.name}
              </Text>
              <IconEdit size={12} color={colors.slate} />
            </Pressable>
            <View style={styles.kinds}>
              {kinds
                .filter((b) => b.sizeId === z.id)
                .map((b) => (
                  <Pressable
                    key={b.id}
                    onPress={() => setBody(b)}
                    style={({ pressed }) => [styles.kind, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${b.name}, priced as ${z.name}. Change`}
                  >
                    <Text style={styles.kindText} numberOfLines={1}>
                      {b.name}
                    </Text>
                  </Pressable>
                ))}
            </View>
          </View>
        ))}
        <Text style={partStyles.note}>Moving a kind changes its price at every branch. Which kinds a branch washes is on the branch’s page.</Text>
      </Panel>

      <NameSheet
        visible={renaming != null}
        title={renaming?.kind === 'class' ? 'Rename vehicle group' : 'Rename size'}
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
    </>
  );
});

function BodyTypeSheet({
  catalog,
  body,
  onClose,
  onSave,
}: {
  catalog: Catalog;
  body: BodyType | null;
  onClose: () => void;
  onSave: (values: { name: string; sizeId: string }) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!body) return;
    setName(body.name);
    setSizeId(body.sizeId);
    setError(null);
    setBusy(false);
  }, [body]);

  const all = catalog.classes.find((c) => c.id === body?.classId)?.sizes ?? [];
  const used = all.filter((z) => z.id === body?.sizeId || catalog.bodyTypes.some((b) => b.sizeId === z.id));

  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    setError(null);
    const message = await onSave({ name: name.trim(), sizeId });
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
      <View style={styles.form}>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={CATALOG_NAME_MAX} autoCapitalize="words" />
        <ChoiceChips
          label="Priced as"
          options={(used.length > 1 ? used : all).map((z) => ({ value: z.id, label: `${z.key} · ${z.name}` }))}
          value={sizeId}
          onChange={setSizeId}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  error: { ...typography.label, color: colors.danger },
  form: { gap: spacing.md },
  sizeRow: { gap: spacing.xs + 2, paddingVertical: 4 },
  sizeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  badge: { minWidth: 32, height: 28, paddingHorizontal: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.label, fontWeight: '800', fontSize: 12.5 },
  sizeName: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, paddingLeft: 40 },
  kind: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: TONE.hub.line,
    backgroundColor: colors.white,
    maxWidth: 220,
  },
  kindText: { fontSize: 13.5, fontWeight: '700', color: colors.waterInk },
});
