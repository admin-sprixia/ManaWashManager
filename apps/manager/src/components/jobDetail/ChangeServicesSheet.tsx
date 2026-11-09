import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { MIN_REASON_LENGTH, parseServiceKind, type Service } from '@mana/domain';
import { BottomSheet, Button, TextField, colors, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { ServicePickRow } from '../ServicePickRow';
import { groupForService } from '../../utils/services';
import { formatRupees } from '../../utils/format';

interface Line {
  serviceId?: string;
  quantity: number;
}

interface Props {
  visible: boolean;
  jobId: string;
  vehicleTypeId: string;
  category: 'car' | 'bike';
  lines: Line[];
  discount: number;
  discountReason: string | null;
  onClose: () => void;
  /** After a save: reload the wash. */
  onSaved: () => void;
}

type MenuService = Service & { modes?: string | null; catalogServiceId?: string | null };

/**
 * The customer changed their mind (Express → Basic): pick the wash's services again. The bill is
 * priced again at today's prices; a manual discount stays (never more than the new bill), and
 * the change is kept in the wash's history with its reason. Needs a connection.
 */
export function ChangeServicesSheet({
  visible,
  jobId,
  vehicleTypeId,
  category,
  lines,
  discount,
  discountReason,
  onClose,
  onSaved,
}: Props) {
  const [menu, setMenu] = useState<{ service: MenuService; price: number }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(new Set(lines.map((l) => l.serviceId).filter((id): id is string => !!id)));
    setReason('');
    setError(null);
    setBusy(false);
    setMenu(null);
    let alive = true;
    void (async () => {
      try {
        const [servicesRes, pricesRes] = await Promise.all([
          api.services.$get({ query: { category } }),
          api.services.prices.$get({ query: { vehicleTypeId, mode: 'hub' } }),
        ]);
        if (!servicesRes.ok || !pricesRes.ok) throw new Error('menu');
        const [services, prices] = await Promise.all([servicesRes.json(), pricesRes.json()]);
        const priceOf = new Map(
          (Array.isArray(prices) ? prices : [])
            .filter((p) => p.vehicleTypeId === vehicleTypeId && (p.mode ?? 'hub') === 'hub')
            .map((p) => [p.serviceId, p.price]),
        );
        const list = (Array.isArray(services) ? (services as unknown as MenuService[]) : [])
          // Done at customers' homes only: not sold at the shop.
          .filter((s) => priceOf.has(s.id) && !(s.catalogServiceId && s.modes === 'doorstep'))
          .map((service) => ({ service, price: priceOf.get(service.id)! }));
        if (alive) setMenu(list);
      } catch (e) {
        if (alive) {
          setError(
            e instanceof NetworkError
              ? 'Changing services needs a connection. Try again when online.'
              : 'Couldn’t load the services.',
          );
          setMenu([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // Filled in once, when the sheet opens: the screen behind redraws (every minute, on sync),
    // and that must never wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const byId = useMemo(() => new Map((menu ?? []).map((m) => [m.service.id, m])), [menu]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      const service = byId.get(id)?.service;
      // One main wash per bill: Basic replaces Express (add-ons stay).
      if (service && parseServiceKind(service.kind) === 'wash') {
        for (const other of [...next]) {
          if (parseServiceKind(byId.get(other)?.service.kind) === 'wash') next.delete(other);
        }
      }
      next.add(id);
      for (const inc of service?.includes ?? []) next.delete(inc);
      return next;
    });
  };

  const quantityOf = (id: string) => lines.find((l) => l.serviceId === id)?.quantity ?? 1;
  const subtotal = [...picked].reduce(
    (sum, id) => sum + (byId.get(id)?.price ?? 0) * quantityOf(id),
    0,
  );
  const keptDiscount = Math.min(discount, subtotal);
  const total = subtotal - keptDiscount;
  const before = new Set(lines.map((l) => l.serviceId));
  const unchanged = picked.size === before.size && [...picked].every((id) => before.has(id));
  const inCombo = new Set([...picked].flatMap((id) => byId.get(id)?.service.includes ?? []));

  const save = async () => {
    if (picked.size === 0) return setError('Pick at least one service.');
    if (reason.trim().length < MIN_REASON_LENGTH)
      return setError('Say why, e.g. “Customer changed to Basic”.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.jobs[':id'].services.$put({
        param: { id: jobId },
        json: {
          services: [...picked].map((serviceId) => ({
            serviceId,
            quantity: quantityOf(serviceId),
          })),
          discount: keptDiscount,
          discountReason: keptDiscount > 0 ? (discountReason ?? 'Discount') : undefined,
          reason: reason.trim(),
        },
      });
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t change the services.'));
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Changing services needs a connection. Try again when online.'
          : 'Couldn’t change the services.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Change services"
      subtitle="The bill is made again at today’s prices"
      footer={
        <Button
          label={picked.size ? `Save · ${formatRupees(total)}` : 'Save'}
          size="lg"
          loading={busy}
          disabled={!menu?.length || unchanged || picked.size === 0}
          onPress={() => void save()}
        />
      }
    >
      {menu == null ? (
        <ActivityIndicator color={colors.water} style={styles.loading} />
      ) : (
        <View>
          {menu.map(({ service, price }, i) => (
            <ServicePickRow
              key={service.id}
              name={service.name}
              group={groupForService(service)}
              priceLabel={formatRupees(price * quantityOf(service.id))}
              selected={picked.has(service.id)}
              onPress={() => toggle(service.id)}
              showDivider={i < menu.length - 1}
              disabledNote={inCombo.has(service.id) ? 'In combo' : undefined}
            />
          ))}
        </View>
      )}
      {keptDiscount > 0 ? (
        <Text style={styles.note}>
          Discount {formatRupees(keptDiscount)} stays{discountReason ? ` · ${discountReason}` : ''}
        </Text>
      ) : null}
      <TextField
        label="Why"
        value={reason}
        onChangeText={setReason}
        placeholder="Customer changed to Basic"
        maxLength={200}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.lg },
  note: { ...typography.caption, color: colors.slate, marginTop: spacing.sm },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
