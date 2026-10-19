import React, { useState } from 'react';
import { IconLock, IconLogout, IconPerson, IconPhone, colors, showAlert, showToast } from '@mana/ui';
import { EdgeGroup, EdgeRow } from './EdgeList';
import { SetPinSheet } from './SetPinSheet';
import { PhonesSheet } from './PhonesSheet';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';

/**
 * Edit profile, change PIN, your phones and sign out. The screen owns the profile sheet (its
 * hero opens it too). `senior`: held to a 6-digit PIN (owners, managers and HQ).
 */
export function AccountGroup({ onEditProfile, senior }: { onEditProfile: () => void; senior: boolean }) {
  const { user, signOut, signIn } = useAuth();
  const { myItems } = useSync();
  const [pinOpen, setPinOpen] = useState(false);
  const [phonesOpen, setPhonesOpen] = useState(false);
  if (!user) return null;

  const confirmSignOut = () => {
    const waiting = myItems.length;
    showAlert(
      'Sign out?',
      waiting > 0
        ? `${waiting} change${waiting === 1 ? '' : 's'} haven’t synced yet. They stay safely on this phone and will sync the next time you sign in here.`
        : 'You’ll sign back in with your number and PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
      { icon: <IconLogout size={26} color={colors.danger} /> },
    );
  };

  return (
    <>
      <EdgeGroup>
        <EdgeRow
          icon={<IconPerson size={19} color={colors.waterDeep} />}
          title="Edit profile"
          subtitle="Your name and mobile number"
          onPress={onEditProfile}
        />
        <EdgeRow
          icon={<IconLock size={19} color={colors.waterDeep} />}
          title="Change PIN"
          subtitle={senior ? 'Your 6-digit sign-in code' : 'Your sign-in code on this or any shop phone'}
          onPress={() => setPinOpen(true)}
        />
        <EdgeRow
          icon={<IconPhone size={19} color={colors.waterDeep} />}
          title="Your phones"
          subtitle="See where you’re signed in, sign out other phones"
          onPress={() => setPhonesOpen(true)}
        />
        <EdgeRow
          icon={<IconLogout size={19} color={colors.danger} />}
          iconBg="#FEE2E2"
          title="Sign out"
          tone="danger"
          chevron={false}
          onPress={confirmSignOut}
        />
      </EdgeGroup>

      <PhonesSheet visible={phonesOpen} onClose={() => setPhonesOpen(false)} />
      <SetPinSheet
        visible={pinOpen}
        title="Change your PIN"
        subtitle={`For +91 ${user.phone}`}
        askCurrent={user.hasPin}
        senior={senior}
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin, currentPin) => {
          try {
            const res = await api.auth.pin.$put({ json: { pin, currentPin } });
            if (!res.ok) {
              const message = await apiErrorMessage(res, 'Couldn’t save your PIN.');
              return res.status === 401 || res.status === 423 ? { currentPinError: message } : message;
            }
            const session = await res.json();
            if ('token' in session) await signIn(session.token, session.user);
            setPinOpen(false);
            showToast('PIN saved. Other phones signed in as you will need the new PIN.');
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'Setting a PIN needs a connection.' : 'Couldn’t save your PIN.';
          }
        }}
      />
    </>
  );
}
