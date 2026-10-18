import React from 'react';
import { IconGrid } from '@mana/ui';
import { unitsSummary, UnitsEditor } from '../UnitsSheet';
import type { ReviewContext, ReviewTab } from './types';

const noun = (c: ReviewContext) => (c.place.type === 'building' ? 'Flat' : 'House');

function FlatsBody({ ctx }: { ctx: ReviewContext }) {
  return <UnitsEditor placeId={ctx.placeId} units={ctx.units} noun={noun(ctx)} run={ctx.run} members={ctx.members} />;
}

/** The flat (or house) and block numbers members pick from when they join. */
export const flatsTab: ReviewTab = {
  key: 'flats',
  label: 'Flats',
  title: 'Flats and blocks',
  icon: (c) => <IconGrid size={17} color={c} />,
  show: () => true,
  state: (c) => (c.units.length ? 'done' : 'optional'),
  summary: (c) => unitsSummary(c.units, noun(c)),
  Body: FlatsBody,
};
