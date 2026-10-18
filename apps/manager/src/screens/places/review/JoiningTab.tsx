import React from 'react';
import { IconLock, TextField } from '@mana/ui';
import { OptionCards } from '../kit';
import type { ReviewContext, ReviewTab } from './types';

const APPROVAL = [
  { value: 'no', label: 'Anyone can join', caption: 'Residents join and pay straight away. Best for most communities.' },
  { value: 'yes', label: 'We confirm each member', caption: 'New people wait under “To confirm” until someone checks their flat and vehicle.', tone: 'amber' },
] as const;

function JoiningBody({ ctx }: { ctx: ReviewContext }) {
  const { approval, setApproval, capacity, setCapacity, capacityError } = ctx.settings;
  return (
    <>
      <OptionCards options={APPROVAL} value={approval} onChange={setApproval} />
      <TextField
        label="Vehicles per wash day"
        optional
        value={capacity}
        onChangeText={(t) => setCapacity(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="No limit"
        error={capacityError}
        hint="Two washers do about 8–10 cars in a morning. When it’s full, new members start on the next wash day with room."
      />
    </>
  );
}

export const joiningTab: ReviewTab = {
  key: 'joining',
  label: 'Joining',
  title: 'Who can join',
  icon: (c) => <IconLock size={17} color={c} />,
  show: () => true,
  state: (c) => (c.settings.capacityError ? 'needed' : 'done'),
  summary: (c) =>
    `${c.settings.approval === 'yes' ? 'We confirm each member' : 'Anyone can join'} · ${c.settings.capacity.trim() ? `${c.settings.capacity} vehicles a day` : 'No daily limit'}`,
  Body: JoiningBody,
};
