import React from 'react';
import type { PlaceStatus } from '@mana/domain';
import { IconSync } from '@mana/ui';
import { OptionCards } from '../kit';
import type { ReviewContext, ReviewTab } from './types';

const STATUS_OPTIONS: { value: PlaceStatus; label: string; caption: string; tone?: 'teal' | 'amber' | 'slate' }[] = [
  { value: 'active', label: 'Washing', caption: 'Wash days go ahead as normal.' },
  { value: 'paused', label: 'Paused', caption: 'No wash days until you switch it back on.', tone: 'amber' },
  { value: 'closed', label: 'Closed', caption: 'The community stops. Nobody new can join.', tone: 'slate' },
];

function StatusBody({ ctx }: { ctx: ReviewContext }) {
  return <OptionCards options={STATUS_OPTIONS} value={ctx.settings.status} onChange={ctx.settings.setStatus} />;
}

export const statusTab: ReviewTab = {
  key: 'status',
  label: 'Status',
  title: 'Status',
  icon: (c) => <IconSync size={17} color={c} />,
  show: (c) => c.settings.live,
  state: (c) => (c.settings.status === 'active' ? 'done' : 'attention'),
  summary: (c) => STATUS_OPTIONS.find((o) => o.value === c.settings.status)!.caption,
  Body: StatusBody,
};
