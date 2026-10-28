import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { inspectionWarnings } from '@mana/domain';
import { IconEdit, IconImage, colors, radius, spacing, typography } from '@mana/ui';
import { TEAL, TEAL_MIST } from '../panel/parts';
import type { Nav } from '../panel/types';
import { missingPhotoKinds, VisitReport } from '../visit/VisitReport';
import { plural } from '../panel/parts';
import type { ReviewContext, ReviewTab } from './types';

function VisitBody({ ctx }: { ctx: ReviewContext }) {
  const nav = useNavigation<Nav>();
  return (
    <>
      <Pressable
        onPress={() => nav.navigate('CommunitySetup', { placeId: ctx.placeId })}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <IconEdit size={15} color={TEAL} />
        <Text style={styles.editText}>Edit visit details and photos</Text>
      </Pressable>
      <VisitReport setup={ctx.place.setup} placeId={ctx.placeId} photos={ctx.place.photos} location={ctx.place.location} />
    </>
  );
}

const issues = (c: ReviewContext) =>
  inspectionWarnings(c.place.setup.inspection).length + c.place.setup.missing.length + missingPhotoKinds(c.place.photos, c.place.setup.inspection).length;

/** What the visit found, for the owner to read before deciding. Reviews only. */
export const visitTab: ReviewTab = {
  key: 'visit',
  label: 'Visit',
  title: 'What the visit found',
  icon: (c) => <IconImage size={17} color={c} />,
  show: (c) => !c.settings.live,
  // The gate, parking and wash space photos are required; water, power and the rest are optional.
  state: (c) => (missingPhotoKinds(c.place.photos, c.place.setup.inspection).length ? 'needed' : issues(c) ? 'attention' : 'done'),
  summary: (c) => {
    const setup = c.place.setup;
    const warnings = inspectionWarnings(setup.inspection).length;
    const noPhotos = missingPhotoKinds(c.place.photos, c.place.setup.inspection).length;
    return [
      warnings ? plural(warnings, 'warning') : 'No warnings',
      plural(c.place.photos.length, 'photo'),
      noPhotos ? `${noPhotos} photo${noPhotos === 1 ? '' : 's'} missing` : null,
      setup.missing.length ? `${setup.missing.length} not filled in` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  },
  Body: VisitBody,
};

const styles = StyleSheet.create({
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#99F6E4',
    backgroundColor: TEAL_MIST,
  },
  editText: { ...typography.label, fontSize: 13.5, fontWeight: '800', color: TEAL },
  pressed: { opacity: 0.8, backgroundColor: colors.surface },
});
