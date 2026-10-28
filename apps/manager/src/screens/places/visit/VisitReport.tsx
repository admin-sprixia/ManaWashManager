import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  bestTimeLabel,
  requiredPhotoKinds,
  formatDay,
  inspectionWarnings,
  PARKING_LABEL,
  PERMISSION_LABEL,
  POWER_LABEL,
  SPACE_LABEL,
  PLACE_PHOTO_KIND_LABEL,
  WATER_LABEL,
  type Inspection,
  type PlacePhotoKind,
} from '@mana/domain';
import {
  IconAlert,
  IconCalendar,
  IconCamera,
  IconCar,
  IconCheck,
  IconClock,
  IconDroplet,
  IconEdit,
  IconGrid,
  IconMapPin,
  IconPerson,
  IconPhone,
  IconShield,
  IconSparkle,
  IconWhatsApp,
  colors,
  formatPhone,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { openWhatsApp } from '../../../utils/whatsapp';
import type { PhotoItem } from '../communityParts';
import { choiceLabel, slotLine } from '../review/options';
import type { PlaceSetup } from '../shared';
import type { Point } from '../../../utils/location';
import { LocationCard } from './LocationCard';
import { PhotoGallery } from './PhotoGallery';
import { BikeIcon, CarIcon } from './VehicleIcons';

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'sky' | 'none';

const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  good: { fg: '#0F766E', bg: '#ECFDF5', border: '#A7F3D0' },
  warn: { fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  bad: { fg: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' },
  info: { fg: colors.indigo, bg: colors.indigoPale, border: '#C4CCF0' },
  sky: { fg: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
  none: { fg: colors.slate, bg: '#F8FAFC', border: '#E2E8F0' },
};

const PERMISSION_TONE = { yes: 'good', pending: 'warn', no: 'bad' } as const;
const WATER_TONE = { yes: 'good', bring: 'warn', no: 'bad' } as const;
const POWER_TONE = { yes: 'good', no: 'warn' } as const;
const SPACE_TONE = { good: 'good', tight: 'warn', no: 'bad' } as const;

interface Check {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  icon: (c: string) => React.ReactNode;
}

/** Every site question, answered or not, with a colour for how good the answer is. */
function siteChecks(i: Inspection): Check[] {
  const missing = { value: 'Not answered', tone: 'none' as Tone };
  return [
    {
      key: 'permission',
      label: 'Society',
      icon: (c) => <IconShield size={16} color={c} />,
      ...(i.permission ? { value: PERMISSION_LABEL[i.permission], tone: PERMISSION_TONE[i.permission] } : missing),
    },
    { key: 'water', label: 'Water', icon: (c) => <IconDroplet size={16} color={c} />, ...(i.water ? { value: WATER_LABEL[i.water], tone: WATER_TONE[i.water] } : missing) },
    { key: 'power', label: 'Power', icon: (c) => <IconSparkle size={16} color={c} />, ...(i.power ? { value: POWER_LABEL[i.power], tone: POWER_TONE[i.power] } : missing) },
    { key: 'space', label: 'Space to wash', icon: (c) => <IconGrid size={16} color={c} />, ...(i.space ? { value: SPACE_LABEL[i.space], tone: SPACE_TONE[i.space] } : missing) },
    { key: 'parking', label: 'Parking', icon: (c) => <IconCar size={16} color={c} />, ...(i.parking ? { value: PARKING_LABEL[i.parking], tone: 'sky' as Tone } : missing) },
    { key: 'best', label: 'Best time', icon: (c) => <IconClock size={16} color={c} />, ...(i.bestTime ? { value: bestTimeLabel(i.bestTime), tone: 'info' as Tone } : missing) },
  ];
}

/** A small coloured heading inside the report. */
function Heading({ icon, title, count, color }: { icon: React.ReactNode; title: string; count?: number; color: string }) {
  return (
    <View style={styles.heading}>
      <View style={[styles.headingIcon, { backgroundColor: `${color}1A` }]}>{icon}</View>
      <Text style={[styles.headingText, { color }]}>{title}</Text>
      {count != null ? <Text style={styles.headingCount}>{count}</Text> : null}
      <View style={[styles.headingRule, { backgroundColor: `${color}33` }]} />
    </View>
  );
}

/** Which of the needed photos (gate, parking, wash space) the visit didn't take: the same rule the server checks. */
export function missingPhotoKinds(photos: readonly PhotoItem[], inspection: Inspection): PlacePhotoKind[] {
  const have = new Set(photos.map((p) => p.kind));
  return requiredPhotoKinds(inspection).filter((k) => !have.has(k));
}

/** A person to call, with call and WhatsApp buttons. */
function ContactRow({ name, role, phone }: { name: string; role?: string; phone: string }) {
  return (
    <View style={styles.contact}>
      <View style={styles.contactAvatar}>
        <IconPerson size={20} color="#BE185D" />
      </View>
      <View style={styles.contactCopy}>
        <Text style={styles.contactName}>
          {name}
          {role && !name.toLowerCase().includes(role.toLowerCase()) ? ` · ${role}` : ''}
        </Text>
        <Text style={styles.contactPhone}>+91 {formatPhone(phone)}</Text>
      </View>
      <Pressable
        onPress={() => void Linking.openURL(`tel:+91${phone}`).catch(() => undefined)}
        style={({ pressed }) => [styles.round, { backgroundColor: '#FCE7F3' }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Call ${name}`}
      >
        <IconPhone size={17} color="#BE185D" />
      </Pressable>
      <Pressable
        onPress={() => void openWhatsApp(phone, 'Hello, this is the Mana Wash team about the car wash at your community.')}
        style={({ pressed }) => [styles.round, { backgroundColor: '#DCFCE7' }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`WhatsApp ${name}`}
      >
        <IconWhatsApp size={17} />
      </Pressable>
    </View>
  );
}

/**
 * The visit, as a report the owner can read in a minute: a verdict, photos, the site check,
 * how many vehicles, what residents asked for, who to call, and notes.
 */
export function VisitReport({
  setup,
  placeId,
  photos,
  location,
}: {
  setup: PlaceSetup;
  placeId: string;
  photos: readonly PhotoItem[];
  /** The gate pin. */
  location?: Point | null;
}) {
  const warnings = inspectionWarnings(setup.inspection);
  const checks = siteChecks(setup.inspection);
  const answered = checks.filter((c) => c.tone !== 'none').length;
  const good = checks.filter((c) => c.tone === 'good' || c.tone === 'sky' || c.tone === 'info').length;
  const noPhotos = missingPhotoKinds(photos, setup.inspection);
  const issues = warnings.length + setup.missing.length + noPhotos.length;
  const { cars, bikes } = setup.inspection;
  const verdict = issues ? TONES.warn : TONES.good;

  return (
    <View style={styles.report}>
      {/* Verdict */}
      <View style={[styles.verdict, { backgroundColor: verdict.bg, borderColor: verdict.border }]}>
        <View style={[styles.verdictIcon, { backgroundColor: verdict.fg }]}>
          {issues ? <IconAlert size={18} color={colors.white} /> : <IconCheck size={18} color={colors.white} />}
        </View>
        <View style={styles.verdictCopy}>
          <Text style={[styles.verdictTitle, { color: verdict.fg }]}>
            {issues ? `${issues} thing${issues === 1 ? '' : 's'} to check` : 'Looks good to approve'}
          </Text>
          <Text style={styles.verdictMeta}>
            {answered} of {checks.length} site questions answered · {good} look fine
          </Text>
          {warnings.map((w) => (
            <Text key={w} style={[styles.verdictLine, { color: TONES.warn.fg }]}>
              • {w}
            </Text>
          ))}
          {setup.missing.length || noPhotos.length ? (
            <View style={styles.missing}>
              {setup.missing.map((m) => (
                <View key={m} style={styles.missingChip}>
                  <Text style={styles.missingText}>{m}</Text>
                </View>
              ))}
              {noPhotos.map((k) => (
                <View key={k} style={styles.photoChip}>
                  <IconCamera size={10} color="#B45309" />
                  <Text style={styles.photoChipText}>No {PLACE_PHOTO_KIND_LABEL[k].toLowerCase()} photo</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {/* Location */}
      {location ? (
        <>
          <Heading icon={<IconMapPin size={13} color="#1D4ED8" />} title="Where it is" color="#1D4ED8" />
          <LocationCard point={location} />
        </>
      ) : null}

      {/* Photos */}
      <Heading icon={<IconCamera size={13} color={colors.indigo} />} title="Photos" count={photos.length} color={colors.indigo} />
      <PhotoGallery placeId={placeId} photos={photos} />

      {/* Site check */}
      <Heading icon={<IconShield size={13} color="#0F766E" />} title="Site check" color="#0F766E" />
      <View style={styles.checks}>
        {checks.map((c) => {
          const t = TONES[c.tone];
          return (
            <View key={c.key} style={[styles.check, { backgroundColor: t.bg, borderColor: t.border }]}>
              <View style={styles.checkTop}>
                <View style={[styles.checkIcon, { backgroundColor: colors.white }]}>{c.icon(t.fg)}</View>
                {c.tone === 'good' ? (
                  <IconCheck size={14} color={t.fg} />
                ) : c.tone === 'warn' || c.tone === 'bad' ? (
                  <IconAlert size={14} color={t.fg} />
                ) : null}
              </View>
              <Text style={styles.checkLabel}>{c.label}</Text>
              <Text style={[styles.checkValue, { color: c.tone === 'none' ? colors.slate : colors.waterInk }]} numberOfLines={2}>
                {c.value}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Vehicles */}
      <Heading icon={<IconCar size={13} color="#0369A1" />} title="Vehicles there" color="#0369A1" />
      <View style={styles.vehicles}>
        <View style={[styles.vehicle, { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' }]}>
          <View style={styles.vehicleIcon}>
            <CarIcon size={28} color="#0369A1" />
          </View>
          <Text style={[styles.vehicleNum, { color: '#0369A1' }]}>{cars ?? '—'}</Text>
          <Text style={styles.vehicleLabel}>Cars, about</Text>
        </View>
        <View style={[styles.vehicle, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}>
          <View style={styles.vehicleIcon}>
            <BikeIcon size={28} color="#6D28D9" />
          </View>
          <Text style={[styles.vehicleNum, { color: '#6D28D9' }]}>{bikes ?? '—'}</Text>
          <Text style={styles.vehicleLabel}>Bikes, about</Text>
        </View>
      </View>

      {/* Residents asked for */}
      <Heading icon={<IconCalendar size={13} color="#B45309" />} title="Residents asked for" count={setup.slots.length} color="#B45309" />
      {setup.slots.length ? (
        <View style={styles.choices}>
          {setup.slots.map((s, i) => (
            <View key={i} style={[styles.choice, i === 0 && styles.choiceFirst]}>
              <View style={[styles.choiceRank, i === 0 && styles.choiceRankFirst]}>
                <Text style={[styles.choiceRankText, i === 0 && styles.choiceRankTextFirst]}>{i + 1}</Text>
              </View>
              <View style={styles.choiceCopy}>
                <Text style={styles.choiceLabel}>{choiceLabel(i)}</Text>
                <Text style={styles.choiceText}>{slotLine(s)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.none}>Not asked yet.</Text>
      )}

      {/* Who to call */}
      <Heading icon={<IconPerson size={13} color="#BE185D" />} title="Who to call there" color="#BE185D" />
      {setup.contactPhone ? <ContactRow name={setup.contactName || 'Contact'} phone={setup.contactPhone} /> : <Text style={styles.none}>No contact number yet.</Text>}
      {setup.securityPhone ? <ContactRow name={setup.securityName || 'Security'} role="Security" phone={setup.securityPhone} /> : null}

      {/* Notes */}
      {setup.notes ? (
        <>
          <Heading icon={<IconEdit size={13} color={colors.slateDeep} />} title="Notes for the team" color={colors.slateDeep} />
          <View style={styles.notes}>
            <Text style={styles.notesText}>{setup.notes}</Text>
          </View>
        </>
      ) : null}

      {/* Who inspected */}
      {setup.createdBy ? (
        <Text style={styles.by}>
          Inspected by {setup.createdBy.name}
          {setup.submittedAt ? ` · sent ${formatDay(setup.submittedAt.slice(0, 10))}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  report: { gap: spacing.sm + 4 },
  pressed: { opacity: 0.75 },

  verdict: { flexDirection: 'row', gap: spacing.sm + 4, padding: spacing.sm + 6, borderRadius: 18, borderWidth: 1 },
  verdictIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  verdictCopy: { flex: 1, gap: 3 },
  verdictTitle: { ...typography.heading, fontSize: 16.5, letterSpacing: -0.2 },
  verdictMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  verdictLine: { ...typography.label, fontSize: 13, fontWeight: '700', marginTop: 2 },
  missing: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  missingChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  missingText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: '#B91C1C', letterSpacing: 0 },
  photoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  photoChipText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: '#B45309', letterSpacing: 0 },

  heading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  headingIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headingText: { ...typography.label, fontSize: 12, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  headingCount: { ...typography.label, fontSize: 12, fontWeight: '800', color: colors.slate },
  headingRule: { flex: 1, height: 1.5, borderRadius: 1 },

  checks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  check: { flexBasis: '47%', flexGrow: 1, padding: spacing.sm + 4, borderRadius: 16, borderWidth: 1, gap: 2 },
  checkTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  checkIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  checkValue: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800' },

  vehicles: { flexDirection: 'row', gap: spacing.sm },
  vehicle: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.md, borderRadius: 18, borderWidth: 1 },
  vehicleIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  vehicleNum: { ...typography.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  vehicleLabel: { ...typography.caption, fontSize: 12, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0 },

  choices: { gap: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFDF5',
  },
  choiceFirst: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
  choiceRank: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  choiceRankFirst: { backgroundColor: '#F59E0B' },
  choiceRankText: { ...typography.label, fontSize: 13, fontWeight: '800', color: '#B45309' },
  choiceRankTextFirst: { color: colors.white },
  choiceCopy: { flex: 1, gap: 1 },
  choiceLabel: { ...typography.caption, fontSize: 11, fontWeight: '700', color: '#B45309', letterSpacing: 0.2 },
  choiceText: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },

  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FBCFE8',
    backgroundColor: '#FDF2F8',
  },
  contactAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  contactCopy: { flex: 1, gap: 1 },
  contactName: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  contactPhone: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0.2 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  notes: { padding: spacing.sm + 4, borderRadius: 14, backgroundColor: '#F8FAFC', borderLeftWidth: 4, borderLeftColor: colors.slate },
  notesText: { ...typography.body, fontSize: 14.5, lineHeight: 21, color: colors.waterInk },

  none: { ...typography.label, fontSize: 13.5, color: colors.slate },
  by: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, textAlign: 'center', marginTop: spacing.sm },
});
