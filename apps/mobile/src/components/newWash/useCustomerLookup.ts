import { useEffect, useRef, useState } from 'react';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { api } from '../../api/client';
import type { DirectoryEntry } from '../../offline/directory';
import { normalizeReg } from '../../utils/services';

interface ServerVehicle {
  id: string;
  customerId: string;
  registrationNumber: string;
  vehicleTypeId: string;
}

interface ServerCustomer {
  id: string;
  name: string | null;
  phone: string;
}

interface PlateResponse {
  customer: ServerCustomer | null;
  vehicle: ServerVehicle;
  visitCount: number;
  lastVisit: string | null;
}

interface PhoneResponse {
  customer: ServerCustomer;
  vehicles: ServerVehicle[];
  visitCount: number;
  lastVisit: string | null;
}

const DEBOUNCE_MS = 400;
const MIN_PLATE_LENGTH = 6;

function toEntry(
  customer: ServerCustomer,
  vehicle: ServerVehicle,
  visitCount: number,
  lastVisit: string | null,
): DirectoryEntry {
  return {
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    vehicleTypeId: vehicle.vehicleTypeId,
    customerId: customer.id,
    customerName: customer.name ?? '',
    customerPhone: customer.phone,
    visitCount,
    lastVisit,
    lastServices: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Exact server lookup by full plate and/or full phone — the fallback for when the phone's
 * saved directory doesn't know someone yet (e.g. added on another phone seconds ago). Pass
 * `enabled: false` when the directory already answered. Offline or failed lookups return nothing.
 */
export function useCustomerLookup(registration: string, phone: string, enabled = true) {
  const [plateEntry, setPlateEntry] = useState<DirectoryEntry | null>(null);
  const [phoneEntries, setPhoneEntries] = useState<DirectoryEntry[]>([]);
  const [looking, setLooking] = useState(false);
  const plateSeq = useRef(0);
  const phoneSeq = useRef(0);

  const reg = normalizeReg(registration);
  const digits = normalizePhone(phone);
  const lookPlate = enabled && reg.length >= MIN_PLATE_LENGTH;
  const lookPhone = enabled && isValidPhone(digits);

  useEffect(() => {
    const seq = ++plateSeq.current;
    setPlateEntry(null);
    if (!lookPlate) {
      setLooking(false);
      return;
    }
    const t = setTimeout(async () => {
      setLooking(true);
      try {
        const res = await api.customers.lookup.$get({ query: { registrationNumber: reg } });
        if (seq !== plateSeq.current || !res.ok) return;
        const body = (await res.json()) as unknown as PlateResponse | null;
        setPlateEntry(
          body?.customer
            ? toEntry(body.customer, body.vehicle, body.visitCount, body.lastVisit)
            : null,
        );
      } catch {
        // Offline or server hiccup: no suggestion, the operator just types the details.
      } finally {
        if (seq === plateSeq.current) setLooking(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [reg, lookPlate]);

  useEffect(() => {
    const seq = ++phoneSeq.current;
    setPhoneEntries([]);
    if (!lookPhone) return;
    const t = setTimeout(async () => {
      try {
        const res = await api.customers.lookup.$get({ query: { phone: digits } });
        if (seq !== phoneSeq.current || !res.ok) return;
        const body = (await res.json()) as unknown as PhoneResponse | null;
        if (!body?.customer) return;
        setPhoneEntries(
          (body.vehicles ?? []).map((v) =>
            toEntry(body.customer, v, body.visitCount, body.lastVisit),
          ),
        );
      } catch {
        // Same as above — silent.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [digits, lookPhone]);

  return { plateEntry, phoneEntries, looking };
}
