import React from 'react';
import { View } from 'react-native';
import { formatDay } from '@mana/domain';
import { IconAlert, IconEdit, IconUserPlus, colors } from '@mana/ui';
import { BoardSectionHeader } from '../../../components/board/BoardSectionHeader';
import { placeTitle, type PlaceListItem } from '../shared';
import { ActionPill, Chip, PanelRow, PlaceTile, plural } from './parts';
import type { Nav } from './types';

interface Item {
  key: string;
  place: PlaceListItem;
  meta: string;
  chip: { label: string; tone: 'amber' | 'danger' | 'slate' | 'teal' };
  action: { label: string; tone: 'teal' | 'amber' | 'soft'; go: () => void };
  open: () => void;
}

/**
 * Everything waiting on a person, in one list: approvals, drafts sent back, new members to
 * confirm, drafts still being filled in. Hidden when there's nothing to do.
 */
export function NeedsYouSection({ places, isOwner, nav }: { places: PlaceListItem[]; isOwner: boolean; nav: Nav }) {
  const open = places.filter((p) => p.status !== 'closed');
  const items: Item[] = [
    ...open
      .filter((p) => p.stage === 'review')
      .map<Item>((p) => ({
        key: `review-${p.id}`,
        place: p,
        meta: `Sent by ${p.setup.createdBy?.name ?? 'the team'}${p.setup.submittedAt ? ` · ${formatDay(p.setup.submittedAt.slice(0, 10))}` : ''}`,
        chip: { label: isOwner ? 'Waiting for your approval' : 'With the owner', tone: 'amber' },
        action: isOwner
          ? { label: 'Review', tone: 'amber', go: () => nav.navigate('PlaceForm', { placeId: p.id }) }
          : { label: 'View', tone: 'soft', go: () => nav.navigate('Place', { placeId: p.id }) },
        open: () => nav.navigate(isOwner ? 'PlaceForm' : 'Place', { placeId: p.id }),
      })),
    ...open
      .filter((p) => p.stage === 'draft' && p.setup.reviewNote)
      .map<Item>((p) => ({
        key: `back-${p.id}`,
        place: p,
        meta: `Owner’s note: ${p.setup.reviewNote}`,
        chip: { label: 'Sent back', tone: 'danger' },
        action: { label: 'Fix', tone: 'teal', go: () => nav.navigate('CommunitySetup', { placeId: p.id }) },
        open: () => nav.navigate('Place', { placeId: p.id }),
      })),
    ...open
      .filter((p) => p.stage === 'live' && p.pending > 0)
      .map<Item>((p) => ({
        key: `pending-${p.id}`,
        place: p,
        meta: 'New people joined. Check their flat and vehicle, then confirm.',
        chip: { label: `${plural(p.pending, 'member')} to confirm`, tone: 'danger' },
        action: { label: 'Confirm', tone: 'teal', go: () => nav.navigate('Place', { placeId: p.id }) },
        open: () => nav.navigate('Place', { placeId: p.id }),
      })),
    ...open
      .filter((p) => p.stage === 'draft' && !p.setup.reviewNote)
      .map<Item>((p) => ({
        key: `draft-${p.id}`,
        place: p,
        meta: p.setup.missing.length
          ? `Still to add: ${p.setup.missing.slice(0, 3).join(', ')}${p.setup.missing.length > 3 ? '…' : ''}`
          : 'All filled in. Send it to the owner.',
        chip: { label: p.setup.missing.length ? 'Draft' : 'Ready to send', tone: p.setup.missing.length ? 'slate' : 'teal' },
        action: { label: 'Continue', tone: 'soft', go: () => nav.navigate('CommunitySetup', { placeId: p.id }) },
        open: () => nav.navigate('Place', { placeId: p.id }),
      })),
  ];

  if (!items.length) return null;

  const urgent = items.filter((i) => i.chip.tone !== 'slate' && i.chip.tone !== 'teal').length;

  return (
    <View>
      <BoardSectionHeader title="Needs you" count={items.length} tone={urgent ? 'alert' : 'default'} />
      {items.map((item, i) => {
        const icon =
          item.chip.tone === 'danger' && item.key.startsWith('pending') ? (
            <IconUserPlus size={11} color={colors.danger} />
          ) : item.chip.tone === 'danger' || item.chip.tone === 'amber' ? (
            <IconAlert size={11} color={item.chip.tone === 'danger' ? colors.danger : colors.amberDeep} />
          ) : (
            <IconEdit size={11} color={colors.slateDeep} />
          );
        return (
          <PanelRow
            key={item.key}
            first={i === 0}
            leading={<PlaceTile name={placeTitle(item.place)} tone={item.chip.tone === 'amber' ? 'amber' : 'teal'} />}
            title={placeTitle(item.place)}
            meta={item.meta}
            right={<ActionPill label={item.action.label} tone={item.action.tone} onPress={item.action.go} />}
            footer={<Chip label={item.chip.label} tone={item.chip.tone} icon={icon} />}
            onPress={item.open}
          />
        );
      })}
    </View>
  );
}
