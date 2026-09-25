import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  calculatePrice,
  couponDiscount,
  isValidPhone,
  normalizePhone,
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
  type Service,
  type ServicePrice,
  type VehicleCategory,
  type VehicleType,
} from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import {
  VEHICLE_CARD_COMPACT_WIDTH,
  VehicleTypeCard,
  vehicleImageFor,
} from '../components/VehicleTypeIcon';
import { GROUP_TONE, ServicePickRow } from '../components/ServicePickRow';
import {
  IconChevronLeft,
  IconClose,
  IconPerson,
  IconPhone,
  IconPlate,
  IconSearch,
  IconTag,
} from '../components/Icons';
import { showToast } from '../components/Toast';
import { FieldRow, StepHeader, type StepState } from '../components/newWash/FormParts';
import { CheckoutBar } from '../components/newWash/CheckoutBar';
import { CustomerSearch } from '../components/newWash/CustomerSearch';
import { WelcomeCard, type RepeatOffer } from '../components/newWash/WelcomeCard';
import { CouponOffer, type UsableCoupon } from '../components/newWash/CouponOffer';
import {
  KnownNotice,
  OwnershipQuestion,
  type OwnershipChoice,
} from '../components/newWash/MatchNotices';
import { useCustomerLookup } from '../components/newWash/useCustomerLookup';
import { colors, gradients, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { useSync } from '../offline/SyncProvider';
import { useDirectory } from '../offline/DirectoryProvider';
import type { DirectoryEntry } from '../offline/directory';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import { newId } from '../utils/id';
import { formatRupees } from '../utils/format';
import { groupForService, normalizeReg, SERVICE_GROUP_ORDER } from '../utils/services';
import {
  classifyQuery,
  entriesForCustomer,
  findByPhone,
  recentEntries,
  searchDirectory,
  type SearchHit,
} from '../utils/customerSearch';
import type { RootStackParamList } from '../navigation/RootNavigator';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type NewWashScreenProps = NativeStackScreenProps<RootStackParamList, 'NewWash'>;

const VEHICLE_FAMILIES: { id: VehicleCategory; label: string }[] = [
  { id: 'car', label: 'Cars' },
  { id: 'bike', label: 'Bikes' },
];

const STEP_LABELS = ['Customer', 'Vehicle', 'Services'] as const;
/** Show the service search only when the menu is long enough to need it. */
const SEARCH_THRESHOLD = 6;

interface CachedCatalog {
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    active: boolean;
    sortOrder: number;
    appliesTo: string;
  }>;
  vehicleTypes: Array<{ id: string; name: string; sortOrder: number; category: string }>;
  prices: ServicePrice[];
}

function normalizeServices(rows: CachedCatalog['services']): Service[] {
  return rows.map((s) => ({ ...s, appliesTo: parseServiceAppliesTo(s.appliesTo) }));
}

function normalizeVehicleTypes(rows: CachedCatalog['vehicleTypes']): VehicleType[] {
  return rows.map((vt) => ({ ...vt, category: parseVehicleCategory(vt.category) }));
}

/**
 * Layout-only transitions. Android can leave views created under an opacity "create"
 * animation stuck invisible when several state changes land in the same frame.
 */
function animate() {
  LayoutAnimation.configureNext({
    duration: 200,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
  });
}

function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * How step 1 is being answered:
 * - `search`: one box finds a saved customer by plate, phone or name.
 * - `known`: a saved vehicle was picked — greet them, everything is filled in.
 * - `form`: new customer / new vehicle / editing saved details, field by field.
 */
type CustomerMode = 'search' | 'known' | 'form';

export function NewWashScreen({ navigation, route }: NewWashScreenProps) {
  const prefillReg = route.params?.registration;
  const prefilled = useRef(false);
  const insets = useSafeAreaInsets();
  const { submit, online } = useSync();
  const directory = useDirectory();
  const scrollRef = useRef<ScrollView>(null);
  const searchRef = useRef<TextInput>(null);
  const regRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const servicesY = useRef(0);

  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [mode, setMode] = useState<CustomerMode>('search');
  const [query, setQuery] = useState('');
  /** The saved vehicle picked from search; stays as the baseline while its details are edited. */
  const [known, setKnown] = useState<DirectoryEntry | null>(null);
  const [ownership, setOwnership] = useState<OwnershipChoice | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [registration, setRegistration] = useState('');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [vehicleFamily, setVehicleFamily] = useState<VehicleCategory>('car');
  const [vehicleTypeId, setVehicleTypeId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [serviceQuery, setServiceQuery] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountRupees, setDiscountRupees] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<UsableCoupon | null>(null);
  const [couponApplied, setCouponApplied] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    // Cached catalog first — New Wash must open instantly and work with no signal.
    const cached = await readCache<CachedCatalog>(CacheKeys.catalog);
    if (cached) {
      setServices(normalizeServices(cached.services));
      setVehicleTypes(normalizeVehicleTypes(cached.vehicleTypes));
      setPrices(cached.prices);
      setCatalogLoading(false);
    }
    try {
      const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
        api.services.$get({ query: {} }),
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.prices.$get({ query: {} }),
      ]);
      if (!servicesRes.ok || !vehicleTypesRes.ok || !pricesRes.ok) {
        throw new Error('Could not load services or vehicle types.');
      }
      const [servicesJson, vehicleTypesJson, pricesJson] = await Promise.all([
        servicesRes.json(),
        vehicleTypesRes.json(),
        pricesRes.json(),
      ]);
      if (!Array.isArray(vehicleTypesJson)) throw new Error('Vehicle types response was invalid.');
      const fresh: CachedCatalog = {
        services: Array.isArray(servicesJson) ? servicesJson : [],
        vehicleTypes: vehicleTypesJson,
        prices: Array.isArray(pricesJson) ? pricesJson : [],
      };
      setServices(normalizeServices(fresh.services));
      setVehicleTypes(normalizeVehicleTypes(fresh.vehicleTypes));
      setPrices(fresh.prices);
      await writeCache(CacheKeys.catalog, fresh);
    } catch (e) {
      if (!cached) {
        setCatalogError(
          e instanceof NetworkError
            ? 'You’re offline and the service list hasn’t been saved on this phone yet. Connect once to load it.'
            : e instanceof Error
              ? e.message
              : 'Could not load services.',
        );
      }
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Pull the latest customers the moment New Wash opens, and put the cursor in the search box.
  const refreshDirectory = directory.refresh;
  useEffect(() => {
    void refreshDirectory({ force: true });
    if (prefillReg) return;
    const t = setTimeout(() => searchRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [refreshDirectory, prefillReg]);

  // ---------- Vehicle + services ----------

  const typesInFamily = useMemo(
    () => vehicleTypes.filter((vt) => vt.category === vehicleFamily),
    [vehicleTypes, vehicleFamily],
  );

  const selectedVehicle = useMemo(
    () => vehicleTypes.find((v) => v.id === vehicleTypeId) ?? null,
    [vehicleTypes, vehicleTypeId],
  );

  const servicesForVehicle = useMemo(() => {
    if (!selectedVehicle) return [];
    return services.filter((s) => serviceAppliesToCategory(s.appliesTo, selectedVehicle.category));
  }, [services, selectedVehicle]);

  const scrollToServices = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, servicesY.current - 4), animated: true });
    }, 260);
  }, []);

  const selectVehicle = useCallback(
    (vt: VehicleType, opts: { scroll?: boolean } = {}) => {
      animate();
      setVehicleFamily(vt.category);
      setVehicleTypeId(vt.id);
      setSelectedServiceIds(new Set());
      setServiceQuery('');
      if (opts.scroll) scrollToServices();
    },
    [scrollToServices],
  );

  const onVehiclePress = (vt: VehicleType) => {
    if (vehicleTypeId === vt.id) {
      animate();
      setVehicleTypeId(null);
      setSelectedServiceIds(new Set());
      return;
    }
    selectVehicle(vt, { scroll: true });
  };

  const switchFamily = (next: VehicleCategory) => {
    if (next === vehicleFamily) return;
    animate();
    setVehicleFamily(next);
    setVehicleTypeId(null);
    setSelectedServiceIds(new Set());
    setServiceQuery('');
  };

  const toggleService = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }, []);

  const priceFor = useCallback(
    (serviceId: string): number | null => {
      if (!vehicleTypeId) return null;
      return (
        prices.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId)?.price ??
        null
      );
    },
    [prices, vehicleTypeId],
  );

  const serviceGroups = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    const matches = q
      ? servicesForVehicle.filter((s) => s.name.toLowerCase().includes(q))
      : servicesForVehicle;
    return SERVICE_GROUP_ORDER.map((group) => ({
      group,
      items: matches.filter((s) => groupForService(s.name) === group),
    })).filter((g) => g.items.length > 0);
  }, [servicesForVehicle, serviceQuery]);

  const selectedServices = useMemo(
    () => servicesForVehicle.filter((s) => selectedServiceIds.has(s.id)),
    [servicesForVehicle, selectedServiceIds],
  );

  // ---------- Customer: search, recognise, or add ----------

  const reg = normalizeReg(registration);
  const phoneDigits = normalizePhone(phone);
  const regOk = reg.length >= 4;
  const phoneOk = isValidPhone(phoneDigits);
  const nameOk = customerName.trim().length > 0;

  const vehicleTypeName = useCallback(
    (id: string) => vehicleTypes.find((vt) => vt.id === id)?.name ?? 'Vehicle',
    [vehicleTypes],
  );

  const queryKind = classifyQuery(query);
  const localHits = useMemo(
    () => searchDirectory(directory.entries, query),
    [directory.entries, query],
  );
  const recents = useMemo(() => recentEntries(directory.entries), [directory.entries]);

  // Directory answers first; the server is only asked for an exact plate / phone it doesn't know.
  const dirPlate = useMemo(
    () =>
      mode === 'form' && regOk
        ? (directory.entries.find((e) => e.registrationNumber === reg) ?? null)
        : null,
    [mode, regOk, reg, directory.entries],
  );
  const dirPhone = useMemo(
    () => (mode === 'form' && phoneOk ? findByPhone(directory.entries, phoneDigits) : null),
    [mode, phoneOk, phoneDigits, directory.entries],
  );
  const lookupReg =
    mode === 'search'
      ? queryKind === 'plate'
        ? query
        : ''
      : mode === 'form' && !dirPlate
        ? registration
        : '';
  const lookupPhone =
    mode === 'search'
      ? queryKind === 'phone'
        ? query
        : ''
      : mode === 'form' && !dirPhone
        ? phone
        : '';
  const server = useCustomerLookup(
    lookupReg,
    lookupPhone,
    online && (mode !== 'search' || localHits.length === 0),
  );

  const searchHits = useMemo<SearchHit[]>(() => {
    if (localHits.length > 0 || mode !== 'search') return localHits;
    const seen = new Set<string>();
    const fromServer = [server.plateEntry, ...server.phoneEntries].filter(
      (e): e is DirectoryEntry => {
        if (!e || seen.has(e.registrationNumber)) return false;
        seen.add(e.registrationNumber);
        return true;
      },
    );
    return fromServer.map((entry) => ({
      entry,
      field: server.plateEntry === entry ? ('plate' as const) : ('phone' as const),
      needle: server.plateEntry === entry ? entry.registrationNumber : entry.customerPhone,
    }));
  }, [localHits, mode, server.plateEntry, server.phoneEntries]);

  const plateEntry = dirPlate ?? server.plateEntry;
  const phoneEntry = dirPhone ?? server.phoneEntries[0] ?? null;
  const phoneCustomerVehicles = useMemo(() => {
    if (!phoneEntry) return [];
    const local = entriesForCustomer(directory.entries, phoneEntry.customerId);
    return local.length > 0 ? local : server.phoneEntries;
  }, [phoneEntry, directory.entries, server.phoneEntries]);

  // Known plate + a different phone: the operator has to say who owns the vehicle now.
  const baseline = known && known.registrationNumber === reg ? known : plateEntry;
  const conflict =
    mode === 'form' && Boolean(baseline) && phoneOk && phoneDigits !== baseline?.customerPhone;
  const holder =
    conflict && phoneEntry && phoneEntry.customerId !== baseline?.customerId ? phoneEntry : null;
  const conflictKey = conflict
    ? `${baseline?.registrationNumber}:${phoneDigits}:${holder?.customerId ?? ''}`
    : null;
  useEffect(() => {
    setOwnership(conflictKey && holder ? 'new_owner' : null);
    // The number is another saved customer's: the wash is theirs, so is the name — unless
    // the operator already typed a different one.
    if (holder && baseline) {
      setCustomerName((n) =>
        !n.trim() || n.trim() === baseline.customerName ? holder.customerName : n,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictKey]);

  const chooseOwnership = (choice: OwnershipChoice) => {
    animate();
    setOwnership(choice);
    if (!baseline || holder) return;
    // A new owner isn't the saved owner: don't let their name carry over to the new profile.
    if (choice === 'new_owner' && customerName.trim() === baseline.customerName) {
      setCustomerName('');
      focusSoon(nameRef);
    } else if (choice === 'same_person' && !customerName.trim()) {
      setCustomerName(baseline.customerName);
    }
  };

  // Typed the number of a saved customer on a new vehicle: fill their name, never overwrite.
  const fillFromPhoneKey =
    mode === 'form' && phoneEntry && !conflict ? phoneEntry.customerId : null;
  useEffect(() => {
    if (!fillFromPhoneKey || !phoneEntry) return;
    setCustomerName((n) => (n.trim() ? n : phoneEntry.customerName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillFromPhoneKey]);

  const knownOthers = useMemo(
    () =>
      known
        ? entriesForCustomer(directory.entries, known.customerId).filter(
            (e) => e.registrationNumber !== known.registrationNumber,
          )
        : [],
    [known, directory.entries],
  );

  const clearOrder = () => {
    setSelectedServiceIds(new Set());
    setServiceQuery('');
    setDiscountOpen(false);
    setDiscountRupees('');
    setDiscountReason('');
  };

  const pickEntry = (entry: DirectoryEntry) => {
    animate();
    Keyboard.dismiss();
    setKnown(entry);
    setMode('known');
    setOwnership(null);
    setVehiclePickerOpen(false);
    setRegistration(entry.registrationNumber);
    setPhone(entry.customerPhone);
    setCustomerName(entry.customerName);
    clearOrder();
    const vt = vehicleTypes.find((v) => v.id === entry.vehicleTypeId);
    if (vt) {
      setVehicleFamily(vt.category);
      setVehicleTypeId(vt.id);
    } else {
      setVehicleTypeId(null);
    }
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // Opened from a customer's profile: skip search and greet them straight away.
  useEffect(() => {
    if (!prefillReg || prefilled.current || vehicleTypes.length === 0 || !directory.ready) return;
    prefilled.current = true;
    const entry = directory.entries.find((e) => e.registrationNumber === prefillReg);
    if (entry) pickEntry(entry);
    else setQuery(prefillReg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillReg, vehicleTypes, directory.ready, directory.entries]);

  const focusSoon = (ref: React.RefObject<TextInput>) =>
    setTimeout(() => ref.current?.focus(), 250);

  const startNewCustomer = () => {
    animate();
    const q = query.trim();
    setKnown(null);
    setMode('form');
    setOwnership(null);
    setRegistration(queryKind === 'plate' ? normalizeReg(q) : '');
    setPhone(queryKind === 'phone' ? normalizePhone(q.replace(/\D/g, '')) : '');
    setCustomerName(queryKind === 'name' ? titleCase(q) : '');
    setVehicleTypeId(null);
    clearOrder();
    focusSoon(queryKind === 'plate' ? phoneRef : regRef);
  };

  const editKnown = () => {
    animate();
    setMode('form');
    focusSoon(phoneRef);
  };

  const addVehicleForKnown = () => {
    animate();
    setKnown(null);
    setMode('form');
    setRegistration('');
    setVehicleTypeId(null);
    clearOrder();
    focusSoon(regRef);
  };

  const backToSearch = () => {
    animate();
    setMode('search');
    setKnown(null);
    setOwnership(null);
    setRegistration('');
    setPhone('');
    setCustomerName('');
    setVehicleTypeId(null);
    setVehiclePickerOpen(false);
    clearOrder();
    focusSoon(searchRef);
  };

  const cancelEdit = () => {
    if (!known) {
      backToSearch();
      return;
    }
    // Back to the saved details, but keep the order that's already been built.
    animate();
    Keyboard.dismiss();
    setMode('known');
    setOwnership(null);
    setRegistration(known.registrationNumber);
    setPhone(known.customerPhone);
    setCustomerName(known.customerName);
  };

  // ---------- Pricing ----------

  const breakdown = useMemo(() => {
    if (!vehicleTypeId || selectedServiceIds.size === 0) return null;
    try {
      return calculatePrice(
        Array.from(selectedServiceIds).map((serviceId) => ({ serviceId, quantity: 1 })),
        vehicleTypeId,
        prices,
      );
    } catch {
      return null;
    }
  }, [vehicleTypeId, selectedServiceIds, prices]);

  const discountPaise = useMemo(() => {
    const rupees = Number(discountRupees);
    if (!discountRupees.trim() || !Number.isFinite(rupees) || rupees <= 0) return 0;
    return Math.round(rupees * 100);
  }, [discountRupees]);

  const subtotal = breakdown?.subtotal ?? 0;
  const discountTooBig = Boolean(breakdown) && discountPaise > subtotal;
  const discountNeedsReason = discountPaise > 0 && discountReason.trim().length === 0;
  const couponActive = couponApplied && offer != null;
  const couponSaving = offer ? couponDiscount(subtotal, offer.percent) : 0;
  const manualDiscount = couponActive || discountTooBig ? 0 : discountPaise;
  const appliedDiscount = couponActive ? couponSaving : manualDiscount;
  const finalTotal = Math.max(0, subtotal - appliedDiscount);

  // A live comeback coupon for the customer at the counter. Asked only for a picked (known)
  // customer and only online — redemption is always re-checked by the server.
  const offerKey = mode === 'known' && online ? `${reg}|${phoneDigits}` : null;
  useEffect(() => {
    setOffer(null);
    setCouponApplied(false);
    if (!offerKey) return;
    let alive = true;
    api.coupons.usable
      .$get({ query: { registrationNumber: reg, phone: phoneDigits } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.coupon) setOffer(data.coupon);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey]);

  const toggleCoupon = () => {
    animate();
    setCouponApplied((on) => {
      if (!on) {
        setDiscountOpen(false);
        setDiscountRupees('');
        setDiscountReason('');
      }
      return !on;
    });
  };

  // ---------- Repeat last wash ----------

  const repeatIds = useMemo(() => {
    if (mode !== 'known' || !known || !vehicleTypeId) return [];
    const offered = new Set(servicesForVehicle.map((s) => s.id));
    return known.lastServices
      .map((s) => s.serviceId)
      .filter((id) => offered.has(id) && priceFor(id) != null);
  }, [mode, known, vehicleTypeId, servicesForVehicle, priceFor]);

  const repeatOffer = useMemo<RepeatOffer | null>(() => {
    if (repeatIds.length === 0 || !vehicleTypeId) return null;
    try {
      const { subtotal: total } = calculatePrice(
        repeatIds.map((serviceId) => ({ serviceId, quantity: 1 })),
        vehicleTypeId,
        prices,
      );
      const names = repeatIds
        .map((id) => services.find((s) => s.id === id)?.name ?? '')
        .filter(Boolean);
      return {
        summary: names.join(' + '),
        total,
        applied:
          selectedServiceIds.size === repeatIds.length &&
          repeatIds.every((id) => selectedServiceIds.has(id)),
      };
    } catch {
      return null;
    }
  }, [repeatIds, vehicleTypeId, prices, services, selectedServiceIds]);

  const repeatLastWash = () => {
    animate();
    setSelectedServiceIds(new Set(repeatIds));
  };

  // ---------- Validation + steps ----------

  const customerDone =
    mode === 'known' ||
    (mode === 'form' && regOk && phoneOk && nameOk && (!conflict || ownership !== null));
  const stepsDone = [customerDone, Boolean(vehicleTypeId), selectedServiceIds.size > 0];
  const activeStep = stepsDone.findIndex((d) => !d);
  const stepState = (i: number): StepState =>
    stepsDone[i] ? 'done' : i === activeStep ? 'active' : 'upcoming';

  const missing =
    mode === 'search'
      ? 'Find the customer, or tap New customer'
      : !regOk
        ? 'Add the vehicle number'
        : !phoneOk
          ? 'Add a valid 10-digit mobile number'
          : !nameOk
            ? 'Add the customer’s name'
            : conflict && !ownership
              ? 'Confirm who owns this vehicle'
              : !vehicleTypeId
                ? 'Choose a vehicle type'
                : selectedServiceIds.size === 0
                  ? 'Pick at least one service'
                  : !breakdown
                    ? 'A selected service has no price for this vehicle'
                    : couponActive && !online
                      ? 'Coupon needs internet — remove it to save offline'
                      : !couponActive && discountTooBig
                        ? 'Discount is more than the bill'
                        : !couponActive && discountNeedsReason
                          ? 'Add a reason for the discount'
                          : null;

  const closeDiscount = () => {
    animate();
    setDiscountOpen(false);
    setDiscountRupees('');
    setDiscountReason('');
  };

  const resetForm = () => {
    setMode('search');
    setQuery('');
    setKnown(null);
    setOwnership(null);
    setRegistration('');
    setPhone('');
    setCustomerName('');
    setVehicleTypeId(null);
    clearOrder();
  };

  const startWash = async () => {
    if (missing || !vehicleTypeId || !breakdown || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const occurredAt = new Date().toISOString();
      const lineItems = Array.from(selectedServiceIds).map((serviceId) => ({
        serviceId,
        quantity: 1,
      }));
      const name = customerName.trim();
      // One offline-safe call: the client id means a retried or queued submission can never
      // create the same wash twice.
      const result = await submit(
        {
          kind: 'job.start',
          payload: {
            id: newId(),
            occurredAt,
            customer: { phone: phoneDigits, name },
            registrationNumber: reg,
            ownership: conflict && ownership ? ownership : undefined,
            vehicleTypeId,
            services: lineItems,
            discount: manualDiscount,
            discountReason: manualDiscount > 0 ? discountReason.trim() : undefined,
            couponCode: couponActive ? offer.code : undefined,
          },
          meta: {
            vehicleTypeName: selectedVehicle?.name ?? 'Vehicle',
            vehicleCategory: selectedVehicle?.category ?? 'car',
            services: selectedServices.map((s) => ({ name: s.name, price: priceFor(s.id) ?? 0 })),
            subtotal,
            total: finalTotal,
          },
        },
        { requireOnline: couponActive },
      );
      if (result.status === 'rejected') throw new Error(result.message);
      directory.recordVisit({
        registrationNumber: reg,
        vehicleTypeId,
        customerName: name,
        customerPhone: phoneDigits,
        services: lineItems,
        samePersonAs: conflict && ownership === 'same_person' ? baseline : null,
        at: occurredAt,
      });
      const firstName = name.split(/\s+/)[0];
      showToast(
        result.status === 'queued'
          ? `Saved offline — ${firstName}’s ${reg} will sync automatically`
          : `Wash started for ${firstName} · ${reg}`,
        result.status === 'queued' ? 'offline' : 'success',
      );
      resetForm();
      navigation.navigate('JobBoard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const doneCount = stepsDone.filter(Boolean).length;
  const headerSubtitle =
    activeStep === -1
      ? 'All set — review and start'
      : `Step ${activeStep + 1} of 3 · ${STEP_LABELS[activeStep]}`;

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <LinearGradient
          colors={gradients.hero as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
        >
          <View pointerEvents="none" style={styles.headerOrb} />
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <IconChevronLeft size={22} color={colors.white} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>New wash</Text>
              <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
            </View>
          </View>
          <View
            style={styles.progress}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 3, now: doneCount }}
          >
            {stepsDone.map((done, i) => (
              <View key={STEP_LABELS[i]} style={styles.progressItem}>
                <View style={[styles.progressTrack, done && styles.progressTrackDone]} />
                <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>
                  {STEP_LABELS[i]}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1 · Customer */}
          <StepHeader
            index={1}
            title="Customer"
            state={stepState(0)}
            hint={
              mode === 'search'
                ? 'Search by plate, phone or name'
                : mode === 'form' && !stepsDone[0]
                  ? known
                    ? 'Editing saved details'
                    : phoneEntry && !plateEntry
                      ? 'New vehicle for a saved customer'
                      : 'New customer — plate, mobile and name'
                  : undefined
            }
            summary={mode === 'form' && stepsDone[0] ? customerName.trim().split(/\s+/)[0] : null}
          />

          {mode === 'search' ? (
            <CustomerSearch
              ref={searchRef}
              query={query}
              onChangeQuery={setQuery}
              hits={searchHits}
              recents={recents}
              queryKind={queryKind}
              vehicleTypeName={vehicleTypeName}
              onPick={pickEntry}
              onNewCustomer={startNewCustomer}
              checkingServer={server.looking && localHits.length === 0}
              status={{
                online,
                count: directory.entries.length,
                lastSyncAt: directory.lastSyncAt,
                syncing: directory.syncing,
              }}
            />
          ) : mode === 'known' && known ? (
            <WelcomeCard
              entry={known}
              vehicleTypeName={vehicleTypeName(vehicleTypeId ?? known.vehicleTypeId)}
              otherVehicles={knownOthers}
              vehicleTypeNameFor={vehicleTypeName}
              repeat={repeatOffer}
              formatMoney={formatRupees}
              onRepeat={repeatLastWash}
              onChange={backToSearch}
              onEdit={editKnown}
              onPickVehicle={pickEntry}
              onAddVehicle={addVehicleForKnown}
            />
          ) : (
            <>
              <View style={styles.group}>
                <FieldRow
                  ref={regRef}
                  icon={<IconPlate size={18} color={colors.waterDeep} />}
                  label="Vehicle number"
                  plate
                  value={registration}
                  onChangeText={(t) => setRegistration(t.toUpperCase())}
                  placeholder="KA 01 AB 1234"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  blurOnSubmit={false}
                  maxLength={13}
                  valid={regOk && !server.looking}
                  trailing={
                    server.looking ? (
                      <ActivityIndicator size="small" color={colors.water} />
                    ) : undefined
                  }
                />
                <FieldRow
                  ref={phoneRef}
                  icon={<IconPhone size={17} color={colors.waterDeep} />}
                  label="Mobile number"
                  prefix="+91"
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/[^\d+ ]/g, ''))}
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => nameRef.current?.focus()}
                  blurOnSubmit={false}
                  maxLength={14}
                  valid={phoneOk}
                />
                <FieldRow
                  ref={nameRef}
                  icon={<IconPerson size={18} color={colors.waterDeep} />}
                  label="Customer name"
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder="Full name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  maxLength={60}
                  valid={nameOk}
                  last
                />
                {conflict && baseline ? (
                  <OwnershipQuestion
                    plate={baseline.registrationNumber}
                    ownerName={baseline.customerName}
                    ownerPhone={baseline.customerPhone}
                    newPhone={phoneDigits}
                    holderName={holder ? holder.customerName || 'another customer' : null}
                    value={ownership}
                    onChange={chooseOwnership}
                  />
                ) : plateEntry && !(known && known.registrationNumber === reg) ? (
                  <KnownNotice
                    name={plateEntry.customerName}
                    id={plateEntry.customerId}
                    eyebrow="SAVED VEHICLE"
                    body={`${plateEntry.registrationNumber} · ${vehicleTypeName(plateEntry.vehicleTypeId)} · ${plateEntry.visitCount} visit${plateEntry.visitCount === 1 ? '' : 's'}`}
                    actionLabel="Use"
                    onAction={() => pickEntry(plateEntry)}
                  />
                ) : phoneEntry && !plateEntry ? (
                  <KnownNotice
                    name={phoneEntry.customerName}
                    id={phoneEntry.customerId}
                    eyebrow="SAVED CUSTOMER"
                    body={`${regOk ? `${reg} will be added to their profile` : 'This vehicle will be added to their profile'} · ${phoneCustomerVehicles.length} vehicle${phoneCustomerVehicles.length === 1 ? '' : 's'} on file`}
                  />
                ) : null}
              </View>
              <Pressable
                onPress={cancelEdit}
                style={styles.linkRow}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={styles.linkText}>
                  {known ? 'Cancel changes' : 'Search saved customers instead'}
                </Text>
              </Pressable>
            </>
          )}

          {/* 2 · Vehicle type */}
          <StepHeader
            index={2}
            title="Vehicle type"
            state={stepState(1)}
            summary={selectedVehicle?.name ?? null}
            hint={selectedVehicle ? undefined : 'Pick Cars or Bikes, then a size'}
          />
          {mode === 'known' && selectedVehicle && !vehiclePickerOpen ? (
            <View style={styles.group}>
              <View style={styles.savedVehicle}>
                <Image
                  source={vehicleImageFor(selectedVehicle.name)}
                  style={styles.savedVehicleImg}
                />
                <View style={styles.flex}>
                  <Text style={styles.savedVehicleName}>{selectedVehicle.name}</Text>
                  <Text style={styles.savedVehicleHint}>Saved from their last visit</Text>
                </View>
                <Pressable
                  onPress={() => {
                    animate();
                    setVehiclePickerOpen(true);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Change vehicle type"
                >
                  <Text style={styles.linkText}>Change</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.segmentWrap}>
                <View style={styles.segment} accessibilityRole="tablist">
                  {VEHICLE_FAMILIES.map((f) => {
                    const on = vehicleFamily === f.id;
                    const count = vehicleTypes.filter((vt) => vt.category === f.id).length;
                    return (
                      <Pressable
                        key={f.id}
                        onPress={() => switchFamily(f.id)}
                        style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                          {f.label}
                        </Text>
                        <Text style={[styles.segmentCount, on && styles.segmentCountOn]}>
                          {count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {catalogLoading && vehicleTypes.length === 0 ? (
                <View style={styles.notice}>
                  <ActivityIndicator color={colors.water} />
                  <Text style={styles.noticeText}>Loading vehicle types…</Text>
                </View>
              ) : catalogError ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeError}>{catalogError}</Text>
                  <Pressable onPress={() => void loadCatalog()} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : typesInFamily.length === 0 ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    No {vehicleFamily} sizes yet. The owner can add them in Services & prices.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.vehicleRow}
                  decelerationRate="fast"
                  snapToInterval={VEHICLE_CARD_COMPACT_WIDTH + spacing.sm + 4}
                  snapToAlignment="start"
                >
                  {typesInFamily.map((vt) => (
                    <VehicleTypeCard
                      key={vt.id}
                      name={vt.name}
                      compact
                      selected={vehicleTypeId === vt.id}
                      onPress={() => onVehiclePress(vt)}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {/* 3 · Services */}
          <View onLayout={(e) => (servicesY.current = e.nativeEvent.layout.y)}>
            <StepHeader
              index={3}
              title="Services"
              state={stepState(2)}
              summary={selectedServiceIds.size > 0 ? `${selectedServiceIds.size} selected` : null}
              hint={
                !selectedVehicle
                  ? 'Choose a vehicle type to see its menu'
                  : `${selectedVehicle.category === 'bike' ? 'Bike' : 'Car'} menu with prices for ${selectedVehicle.name}`
              }
            />
          </View>

          {!selectedVehicle ? (
            <View style={[styles.notice, styles.noticeSoft]}>
              <Text style={styles.noticeTitle}>Services appear here</Text>
              <Text style={styles.noticeText}>
                Each size has its own price list, so pick the{' '}
                {vehicleFamily === 'bike' ? 'bike' : 'car'} size first.
              </Text>
            </View>
          ) : servicesForVehicle.length === 0 ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                No {selectedVehicle.category} services yet. The owner can add them in Services &
                prices.
              </Text>
            </View>
          ) : (
            <>
              {servicesForVehicle.length > SEARCH_THRESHOLD ? (
                <View style={styles.searchWrap}>
                  <View style={styles.search}>
                    <IconSearch size={17} color={colors.slate} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder={`Search ${servicesForVehicle.length} services`}
                      placeholderTextColor={colors.slate}
                      value={serviceQuery}
                      onChangeText={setServiceQuery}
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    {serviceQuery ? (
                      <Pressable
                        onPress={() => setServiceQuery('')}
                        hitSlop={10}
                        accessibilityLabel="Clear search"
                      >
                        <View style={styles.clearBtn}>
                          <IconClose size={10} color={colors.white} />
                        </View>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {serviceGroups.length === 0 ? (
                <Text style={styles.emptySearch}>No services match “{serviceQuery}”</Text>
              ) : (
                serviceGroups.map(({ group, items }) => (
                  <View key={group}>
                    <View style={styles.groupLabelRow}>
                      <View
                        style={[styles.groupDot, { backgroundColor: GROUP_TONE[group].accent }]}
                      />
                      <Text style={styles.groupLabel}>{group}</Text>
                    </View>
                    <View style={styles.group}>
                      {items.map((s, i) => {
                        const price = priceFor(s.id);
                        return (
                          <ServicePickRow
                            key={s.id}
                            name={s.name}
                            group={group}
                            meta={s.description?.trim() || null}
                            priceLabel={price != null ? formatRupees(price) : 'No price'}
                            selected={selectedServiceIds.has(s.id)}
                            onPress={() => toggleService(s.id)}
                            showDivider={i < items.length - 1}
                          />
                        );
                      })}
                    </View>
                  </View>
                ))
              )}

              {offer ? (
                <CouponOffer
                  coupon={offer}
                  registrationNumber={reg}
                  applied={couponActive}
                  saving={couponSaving}
                  online={online}
                  formatMoney={formatRupees}
                  onToggle={toggleCoupon}
                />
              ) : null}

              {/* Optional discount */}
              {breakdown && !couponActive ? (
                <View style={[styles.group, styles.discountGroup]}>
                  {!discountOpen ? (
                    <Pressable
                      onPress={() => {
                        animate();
                        setDiscountOpen(true);
                      }}
                      android_ripple={{ color: colors.waterPale }}
                      style={styles.discountRow}
                      accessibilityRole="button"
                    >
                      <View style={styles.discountIcon}>
                        <IconTag size={17} color={colors.amberDeep} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.discountTitle}>Add a discount</Text>
                        <Text style={styles.discountHint}>
                          Optional · needs a reason for the owner’s records
                        </Text>
                      </View>
                      <Text style={styles.discountAdd}>Add</Text>
                    </Pressable>
                  ) : (
                    <>
                      <FieldRow
                        icon={<IconTag size={17} color={colors.amberDeep} />}
                        label={`Discount (max ${formatRupees(subtotal)})`}
                        prefix="₹"
                        value={discountRupees}
                        onChangeText={(t) => setDiscountRupees(t.replace(/[^\d]/g, ''))}
                        placeholder="0"
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                        trailing={
                          <Pressable
                            onPress={closeDiscount}
                            hitSlop={8}
                            accessibilityLabel="Remove discount"
                          >
                            <Text style={styles.discountRemove}>Remove</Text>
                          </Pressable>
                        }
                      />
                      <FieldRow
                        icon={<IconPerson size={17} color={colors.amberDeep} />}
                        label="Reason"
                        value={discountReason}
                        onChangeText={setDiscountReason}
                        placeholder="e.g. first visit, regular customer"
                        maxLength={80}
                        last
                      />
                      {discountTooBig || discountNeedsReason ? (
                        <Text style={styles.discountError}>
                          {discountTooBig
                            ? `Discount can’t be more than ${formatRupees(subtotal)}.`
                            : 'Add a reason so the discount can be tracked.'}
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {mode === 'search' && keyboardOpen ? null : (
          <CheckoutBar
            serviceCount={selectedServiceIds.size}
            subtotal={subtotal}
            discount={appliedDiscount}
            discountLabel={couponActive ? `${offer.percent}% coupon` : undefined}
            total={finalTotal}
            missing={missing}
            submitting={submitting}
            onSubmit={() => void startWash()}
          />
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
    gap: spacing.md,
  },
  headerOrb: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -80,
    right: -50,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  headerCopy: { flex: 1 },
  headerTitle: {
    ...typography.title,
    color: colors.white,
    fontSize: 26,
    letterSpacing: -0.5,
    textShadowColor: 'rgba(8,47,73,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerSubtitle: { ...typography.body, color: 'rgba(255,255,255,0.88)', fontSize: 14 },
  progress: { flexDirection: 'row', gap: spacing.sm },
  progressItem: { flex: 1, gap: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)' },
  progressTrackDone: { backgroundColor: colors.white },
  progressLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  progressLabelDone: { color: colors.white, fontWeight: '700' },
  content: { paddingBottom: spacing.xl },
  group: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentWrap: { paddingHorizontal: spacing.md },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E6EEF6',
    borderRadius: radius.md + 2,
    padding: 3,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  segmentBtnOn: {
    backgroundColor: colors.white,
    shadowColor: colors.waterMidnight,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentText: { ...typography.bodyStrong, color: colors.slateDeep, fontSize: 15 },
  segmentTextOn: { color: colors.waterInk },
  segmentCount: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.slate,
    minWidth: 20,
    textAlign: 'center',
  },
  segmentCountOn: { color: colors.water },
  vehicleRow: { gap: spacing.sm + 4, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  noticeSoft: { backgroundColor: '#F1F7FD', borderStyle: 'dashed', borderColor: '#BFD7EA' },
  noticeTitle: { ...typography.bodyStrong, color: colors.waterInk },
  noticeText: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  noticeError: { ...typography.body, color: colors.danger, fontSize: 14 },
  retryBtn: {
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: { ...typography.label, color: colors.white },
  searchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E6EEF6',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.waterInk,
    paddingVertical: 10,
  },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySearch: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
    padding: spacing.lg,
  },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: 6,
  },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  discountGroup: { marginTop: spacing.lg },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  discountIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  discountHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  discountAdd: { ...typography.label, color: colors.water, fontSize: 14 },
  discountRemove: { ...typography.label, color: colors.danger, fontSize: 13 },
  discountError: {
    ...typography.caption,
    color: colors.danger,
    letterSpacing: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
  linkRow: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.sm + 4 },
  linkText: { ...typography.label, color: colors.water, fontSize: 14 },
  savedVehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  savedVehicleImg: { width: 64, height: 46, borderRadius: radius.sm + 2 },
  savedVehicleName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  savedVehicleHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  error: {
    ...typography.label,
    color: colors.danger,
    textTransform: 'none',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
