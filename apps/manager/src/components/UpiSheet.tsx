import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, TextField, colors, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { UpiQr } from './UpiQr';

const UPI_ID = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** Owner sets the shop's UPI ID; Collect payment then shows a QR with the amount filled in. */
export function UpiSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { upiId, setUpiId, info } = useShop();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValue(upiId ?? '');
    setError(null);
    setBusy(false);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmed = value.trim().toLowerCase();
  const valid = trimmed === '' || UPI_ID.test(trimmed);
  const changed = trimmed !== (upiId ?? '');
  const removing = changed && trimmed === '' && upiId != null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.shop.settings.$put({ json: { upiId: trimmed || null } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save the UPI ID.'));
        return;
      }
      const body = await res.json();
      setUpiId(body.upiId);
      showToast(body.upiId ? 'UPI QR is on' : 'UPI QR removed');
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Saving needs a connection.' : 'Couldn’t save the UPI ID.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="UPI QR code"
      subtitle="Customers scan it to pay the exact amount. The money goes straight to your bank."
      footer={
        <Button
          label={removing ? 'Remove UPI ID' : upiId && !changed ? 'Saved' : 'Save'}
          variant={removing ? 'danger' : 'primary'}
          size="lg"
          loading={busy}
          disabled={!valid || !changed}
          onPress={() => void save()}
        />
      }
    >
      <TextField
        label="Your shop’s UPI ID"
        value={value}
        onChangeText={(t) => {
          setValue(t);
          setError(null);
        }}
        placeholder="shopname@okaxis"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={100}
        error={valid ? null : 'Enter a UPI ID like shopname@okaxis'}
        hint={valid ? 'Find it in your GPay, PhonePe or bank app under “UPI ID”.' : undefined}
      />
      {trimmed && valid ? (
        <View style={styles.preview}>
          <UpiQr upiId={trimmed} payee={info?.name ?? 'Car wash'} amount={100} note="Test" size={150} />
          <Text style={styles.previewHint}>Test it: scan with your own phone. It should show your name and ₹1.</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: spacing.sm },
  previewHint: { ...typography.caption, color: colors.slateDeep, textAlign: 'center', letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger },
});
