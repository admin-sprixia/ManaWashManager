import React, { useEffect, useState } from 'react';
import { CUSTOMER_NAME_MAX } from '@mana/domain';
import { BottomSheet, Button, TextField, showToast } from '@mana/ui';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';

/** Change the name the car wash knows them by, at every branch they're a customer of. */
export function EditNameSheet({
  visible,
  current,
  onClose,
}: {
  visible: boolean;
  current: string | null;
  onClose: () => void;
}) {
  const { refreshAccount } = useAuth();
  const [name, setName] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(current ?? '');
      setError(null);
    }
  }, [visible, current]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send(api.me.$patch({ json: { name: trimmed } }));
      await refreshAccount();
      showToast('Name saved', 'success');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your name"
      subtitle="The car wash team sees this on your washes."
      dismissable={!busy}
      footer={<Button label="Save" size="lg" loading={busy} onPress={() => void save()} />}
    >
      <TextField
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (error) setError(null);
        }}
        autoCapitalize="words"
        autoFocus
        maxLength={CUSTOMER_NAME_MAX}
        error={error}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
    </BottomSheet>
  );
}
