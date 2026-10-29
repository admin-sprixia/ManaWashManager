import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  unstable_batchedUpdates,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  calculatePrice,
  couponDiscount,
  formatDuration,
  isValidPhone,
  normalizePhone,
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
  distanceKm,
  roadKm,
  visitCharge,
  type DeliveryMode,
  type DoorstepVisitRules,
  type Service,
  type ServicePrice,
  type VehicleCategory,
  type VehicleType,
} from '@mana/domain';
import {
  ScreenContainer,
  IconChevronLeft,
  IconClose,
  IconPerson,
  IconPhone,
  IconPlate,
  IconSearch,
  IconTag,
  showToast,
  colors,
  gradients,
  radius,
  spacing,
  typography,
  MakeLogo,
  VehicleArt,
  suggestedTypeId,
} from '@mana/ui';
import {
  VEHICLE_CARD_COMPACT_WIDTH,
  VehicleTypeCard,
} from '../components/VehicleTypeIcon';
import { GROUP_TONE, ServicePickRow } from '../components/ServicePickRow';
import { FieldRow, StepHeader, type StepState } from '../components/newWash/FormParts';
import { CheckoutBar } from '../components/newWash/CheckoutBar';
import { CustomerSearch } from '../components/newWash/CustomerSearch';
import { WelcomeCard, type RepeatOffer } from '../components/newWash/WelcomeCard';
import { CouponOffer, type UsableCoupon } from '../components/newWash/CouponOffer';
import { PlanWashCard, type ShopPlan } from '../components/newWash/PlanWashCard';
import { ReferralField, useReferralQuote } from '../components/newWash/ReferralField';
import { SellerField } from '../components/newWash/SellerField';
import { RewardsPanel } from '../components/newWash/RewardsPanel';
import { VisitCard } from '../components/newWash/VisitCard';
import { SellPlanSheet } from '../components/newWash/SellPlanSheet';
import { VehicleModelPicker, useModelEdits } from '../components/newWash/VehicleModelPicker';
import { BeforePhotos, type PendingPhoto } from '../components/newWash/BeforePhotos';
import { deleteLocalCopy } from '../offline/photoFiles';
import type { Point } from '../utils/location';
import { useVehicleRewards } from '../components/newWash/useVehicleRewards';
import type { RewardCard } from '../offline/types';
import { useShop } from '../offline/ShopProvider';
import type { Person } from '../components/PeoplePickerSheet';
import {
  KnownNotice,
  OwnershipQuestion,
  type OwnershipChoice,
} from '../components/newWash/MatchNotices';
import { useCustomerLookup } from '../components/newWash/useCustomerLookup';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { useSync } from '../offline/SyncProvider';
import { useAuth } from '../api/auth';
import { useDirectory } from '../offline/DirectoryProvider';
import type { DirectoryEntry } from '../offline/directory';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import { newId } from '../utils/id';
import { useOpened } from '../utils/useOpened';
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
    /** 'addon' goes with a wash only; missing from catalogs saved by older versions. */
    kind?: string;
  }>;
  /** `bodyKey`: missing from catalogs saved by older versions (types are then matched by name). */
  vehicleTypes: Array<{ id: string; name: string; sortOrder: number; category: string; bodyKey?: string | null }>;
  prices: ServicePrice[];
  /** Staff commission per service per size; missing from catalogs saved by older versions. */
  commissions?: CommissionRate[];
  /** How this branch washes: at its hub, at the customer's door, or both. */
  modes: DeliveryMode[];
  /** What a home visit adds to the bill; missing from catalogs saved by older versions. */
  visit?: DoorstepVisitRules | null;
  /** The branch's map pin, to measure how far a home is. */
  branchPoint?: Point | null;
  /** Vehicle types washed at homes only (the hub doesn't take them). */
  homeOnlyTypes?: string[];
}

const WASH_MODES: { id: DeliveryMode; label: string }[] = [
  { id: 'hub', label: 'At the shop' },
  { id: 'doorstep', label: 'Doorstep' },
];

interface CommissionRate {
  serviceId: string;
  vehicleTypeId: string;
  amount: number;
}

function normalizeServices(rows: CachedCatalog['services']): Service[] {
  return rows.map((s) => ({ ...s, appliesTo: parseServiceAppliesTo(s.appliesTo) }));
}

/** A branch vehicle type, with the body type a company and model find it by. */
type WashVehicleType = VehicleType & { bodyKey: string | null };

function normalizeVehicleTypes(rows: CachedCatalog['vehicleTypes']): WashVehicleType[] {
  return rows.map((vt) => ({ ...vt, category: parseVehicleCategory(vt.category), bodyKey: vt.bodyKey ?? null }));
}

interface LoadedCatalog {
  services: Service[];
  vehicleTypes: WashVehicleType[];
  allPrices: ServicePrice[];
  modes: DeliveryMode[];
  visitRules: DoorstepVisitRules | null;
  branchPoint: Point | null;
  homeOnlyTypes: string[];
  commissions: CommissionRate[];
}

function loadedFrom(c: CachedCatalog | null): LoadedCatalog {
  return {
    services: c ? normalizeServices(c.services) : [],
    vehicleTypes: c ? normalizeVehicleTypes(c.vehicleTypes) : [],
    allPrices: c?.prices ?? [],
    modes: c?.modes ?? ['hub'],
    visitRules: c?.visit ?? null,
    branchPoint: c?.branchPoint ?? null,
    homeOnlyTypes: c?.homeOnlyTypes ?? [],
    commissions: c?.commissions ?? [],
  };
}

/** The last catalog this app loaded, for its branch, so New Wash opens with it already in hand. */
let memory: { shopId: string; catalog: CachedCatalog } | null = null;

function memoryFor(shopId: string | undefined): CachedCatalog | null {
  return shopId && memory?.shopId === shopId ? memory.catalog : null;
}

function remember(shopId: string | undefined, catalog: CachedCatalog) {
  if (shopId) memory = { shopId, catalog };
}

function readCatalogCache(): Promise<CachedCatalog | null> {
  return readCache<CachedCatalog>(CacheKeys.catalog);
}

/** Reads the saved catalog into memory ahead of time (the home board calls this). */
export async function warmNewWash(shopId: string): Promise<void> {
  if (memoryFor(shopId)) return;
  const saved = await readCatalogCache();
  if (saved) remember(shopId, saved);
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
  const { user } = useAuth();
  const { rewards: rewardSettings, rewardsOn, refreshRewards, refreshStock } = useShop();
  const directory = useDirectory();
  const scrollRef = useRef<ScrollView>(null);
  const searchRef = useRef<TextInput>(null);
  const regRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const servicesY = useRef(0);

  // The catalog as one value (one redraw per load), starting from the copy kept in memory.
  const shopId = user?.shopId;
  const [catalog, setCatalog] = useState<LoadedCatalog>(() => loadedFrom(memoryFor(shopId)));
  const { services, vehicleTypes, allPrices, modes, visitRules, branchPoint, homeOnlyTypes, commissions } = catalog;
  /** False until the screen has slid in: the downloads and the keyboard wait for it. */
  const opened = useOpened(navigation);
  /** A home wash: where the phone was measured at the home; null = not yet. */
  const [visitPoint, setVisitPoint] = useState<Point | null>(null);
  /** Bumped to clear the visit card for the next customer. */
  const [visitKey, setVisitKey] = useState(0);
  const preferredMode = route.params?.mode;
  const [washMode, setWashMode] = useState<DeliveryMode>(preferredMode ?? 'hub');
  /** Once someone flips the menu by hand, the home tab's choice stops applying. */
  const pickedMode = useRef(false);
  const [catalogLoading, setCatalogLoading] = useState(() => memoryFor(shopId) == null);
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
  /** Company and model from the size guide's list; the model picks the vehicle type. */
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  /** The type is being picked by hand (model not listed, or the suggestion overridden). */
  const [manualType, setManualType] = useState(false);
  const modelEdits = useModelEdits(opened);
  /** Before photos taken here; they go up with the wash when it's started. */
  const [beforePhotos, setBeforePhotos] = useState<PendingPhoto[]>([]);
  // Leaving New Wash without starting the wash: its photos are of nothing, so drop their files.
  const unsentPhotos = useRef<PendingPhoto[]>([]);
  unsentPhotos.current = beforePhotos;
  useEffect(
    () => () => {
      for (const p of unsentPhotos.current) void deleteLocalCopy(p.uri);
    },
    [],
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [serviceQuery, setServiceQuery] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountRupees, setDiscountRupees] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<UsableCoupon | null>(null);
  const [couponApplied, setCouponApplied] = useState(false);
  const [referrerPhone, setReferrerPhone] = useState('');
  /** Services the customer takes free from the car's stamp cards. */
  const [freeIds, setFreeIds] = useState<Set<string>>(new Set());
  /** The customer's community plans, and the one paying for this wash. */
  const [shopPlans, setShopPlans] = useState<ShopPlan[]>([]);
  const [planOrderId, setPlanOrderId] = useState<string | null>(null);
  /** Plans bought at this counter for the vehicle. */
  const [counterPlans, setCounterPlans] = useState<ShopPlan[]>([]);
  const [selling, setSelling] = useState(false);
  /** Who got a commission service; `null` means whoever is entering the wash. */
  const [sellers, setSellers] = useState<Person[] | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    // The saved catalog first — New Wash must open instantly and work with no signal.
    const inMemory = memoryFor(shopId);
    const cached = inMemory ?? (await readCatalogCache());
    if (cached && !inMemory) {
      remember(shopId, cached);
      unstable_batchedUpdates(() => {
        setCatalog(loadedFrom(cached));
        setCatalogLoading(false);
      });
    }
    try {
      const [servicesRes, vehicleTypesRes, pricesRes, commissionsRes, networkRes] = await Promise.all([
        api.services.$get({ query: {} }),
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.prices.$get({ query: {} }),
        api.services.commissions.$get(),
        api.services.network.$get(),
      ]);
      if (!servicesRes.ok || !vehicleTypesRes.ok || !pricesRes.ok || !commissionsRes.ok) {
        throw new Error('Could not load services or vehicle types.');
      }
      const [servicesJson, vehicleTypesJson, pricesJson, commissionsJson, network] = await Promise.all([
        servicesRes.json(),
        vehicleTypesRes.json(),
        pricesRes.json(),
        commissionsRes.json(),
        networkRes.ok ? networkRes.json() : null,
      ]);
      if (!Array.isArray(vehicleTypesJson)) throw new Error('Vehicle types response was invalid.');
      const fresh: CachedCatalog = {
        services: Array.isArray(servicesJson) ? servicesJson : [],
        vehicleTypes: vehicleTypesJson,
        prices: Array.isArray(pricesJson) ? pricesJson : [],
        commissions: Array.isArray(commissionsJson)
          ? commissionsJson.map(({ serviceId, vehicleTypeId, amount }) => ({ serviceId, vehicleTypeId, amount }))
          : [],
        modes: network?.modes.length ? network.modes : ['hub'],
        visit: network?.visit ?? cached?.visit ?? null,
        branchPoint: network ? network.location : (cached?.branchPoint ?? null),
        homeOnlyTypes: network ? network.homeOnlyTypes : (cached?.homeOnlyTypes ?? []),
      };
      // Nothing changed since the saved copy: no redraw at all.
      if (!cached || JSON.stringify(fresh) !== JSON.stringify(cached)) {
        remember(shopId, fresh);
        setCatalog(loadedFrom(fresh));
        await writeCache(CacheKeys.catalog, fresh);
      }
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
  }, [shopId]);

  // The copy saved on this phone straight away (when it isn't in memory yet); the server's once
  // the screen has slid in.
  useEffect(() => {
    if (memoryFor(shopId)) return;
    let alive = true;
    void readCatalogCache().then((saved) => {
      if (!alive || !saved || memoryFor(shopId)) return;
      remember(shopId, saved);
      unstable_batchedUpdates(() => {
        setCatalog(loadedFrom(saved));
        setCatalogLoading(false);
      });
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  useEffect(() => {
    if (opened) void loadCatalog();
  }, [opened, loadCatalog]);

  // A doorstep-only branch starts on the doorstep menu; a branch that closed its doorstep team
  // falls back to the hub.
  useEffect(() => {
    if (!pickedMode.current && preferredMode && modes.includes(preferredMode)) {
      if (washMode !== preferredMode) setWashMode(preferredMode);
      return;
    }
    if (!modes.includes(washMode)) setWashMode(modes[0] ?? 'hub');
  }, [modes, washMode, preferredMode]);

  /**
   * The menu for how this wash is delivered. A home wash is head office's hub price (the visit
   * charge is its own line); a branch's hand-made service keeps its own doorstep price. Services
   * done only at communities or only at the shop aren't sold at homes, and home-only ones aren't
   * sold at the shop.
   */
  const menuFilter = useMemo(() => {
    const notAtHomes = new Set(services.filter((s) => s.teamAt === 'community' || s.modes === 'hub').map((s) => s.id));
    const homesOnly = new Set(services.filter((s) => s.catalogServiceId && s.modes === 'doorstep').map((s) => s.id));
    const fromHq = new Set(services.filter((s) => s.catalogServiceId).map((s) => s.id));
    return { notAtHomes, homesOnly, fromHq, homeOnlyTypes: new Set(homeOnlyTypes) };
  }, [services, homeOnlyTypes]);
  const prices = useMemo(
    () =>
      allPrices.filter((p) => {
        const m = p.mode ?? 'hub';
        if (washMode === 'doorstep') {
          if (menuFilter.notAtHomes.has(p.serviceId)) return false;
          return m === (menuFilter.fromHq.has(p.serviceId) ? 'hub' : 'doorstep');
        }
        return m === 'hub' && !menuFilter.homesOnly.has(p.serviceId) && !menuFilter.homeOnlyTypes.has(p.vehicleTypeId);
      }),
    [allPrices, washMode, menuFilter],
  );

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
    if (!opened) return;
    void refreshDirectory({ force: true });
    if (!prefillReg) searchRef.current?.focus();
  }, [opened, refreshDirectory, prefillReg]);

  // ---------- Vehicle + services ----------

  const typesInFamily = useMemo(
    () => vehicleTypes.filter((vt) => vt.category === vehicleFamily),
    [vehicleTypes, vehicleFamily],
  );

  const selectedVehicle = useMemo(
    () => vehicleTypes.find((v) => v.id === vehicleTypeId) ?? null,
    [vehicleTypes, vehicleTypeId],
  );

  // A service is offered for exactly the vehicles the owner priced it for.
  const servicesForVehicle = useMemo(() => {
    if (!selectedVehicle) return [];
    const priced = new Set(prices.filter((p) => p.vehicleTypeId === selectedVehicle.id).map((p) => p.serviceId));
    return services.filter(
      (s) => serviceAppliesToCategory(s.appliesTo, selectedVehicle.category) && priced.has(s.id),
    );
  }, [services, prices, selectedVehicle]);

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
      setFreeIds(new Set());
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
      setFreeIds(new Set());
      return;
    }
    selectVehicle(vt, { scroll: true });
  };

  const clearModel = () => {
    setMake(null);
    setModel(null);
    setManualType(false);
  };

  // A new company starts over: its models (and so the type) are different.
  const pickMake = (next: string) => {
    if (next === make) return;
    animate();
    setMake(next);
    setModel(null);
    setManualType(false);
    setVehicleTypeId(null);
    setSelectedServiceIds(new Set());
    setFreeIds(new Set());
  };

  // The model picks the type, and the menu opens; with no type for it here, it's picked by hand.
  const pickModel = (next: string, typeId: string | null) => {
    setModel(next);
    const vt = typeId ? vehicleTypes.find((v) => v.id === typeId) : undefined;
    if (vt) {
      setManualType(false);
      setVehiclePickerOpen(false);
      selectVehicle(vt, { scroll: true });
      return;
    }
    animate();
    setManualType(true);
    setVehicleTypeId(null);
    setSelectedServiceIds(new Set());
    setFreeIds(new Set());
  };
  const modelTypeId = useMemo(
    () => (make && model ? suggestedTypeId(vehicleTypes, make, model, modelEdits) : null),
    [make, model, vehicleTypes, modelEdits],
  );

  const switchWashMode = (next: DeliveryMode) => {
    if (next === washMode) return;
    pickedMode.current = true;
    animate();
    setWashMode(next);
    setSelectedServiceIds(new Set());
    setFreeIds(new Set());
  };

  const switchFamily = (next: VehicleCategory) => {
    if (next === vehicleFamily) return;
    animate();
    setVehicleFamily(next);
    setVehicleTypeId(null);
    setSelectedServiceIds(new Set());
    setFreeIds(new Set());
    setServiceQuery('');
  };

  // Picking a combo drops the services it already covers, so nothing is charged twice.
  const toggleService = useCallback(
    (serviceId: string) => {
      setSelectedServiceIds((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else {
          next.add(serviceId);
          for (const id of services.find((s) => s.id === serviceId)?.includes ?? []) next.delete(id);
        }
        return next;
      });
    },
    [services],
  );

  /** Service id → name of the picked combo that already covers it. */
  const coveredBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of services) {
      if (!selectedServiceIds.has(s.id)) continue;
      for (const id of s.includes ?? []) map.set(id, s.name);
    }
    return map;
  }, [services, selectedServiceIds]);

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

  /** "Foam Wash + Interior · Save ₹250" — what a combo bundles and what it saves on this vehicle. */
  const comboMeta = (combo: Service, price: number | null): string | null => {
    const included = (combo.includes ?? [])
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => s != null);
    if (included.length === 0) return combo.description?.trim() || null;
    const parts = [included.map((s) => s.name).join(' + ')];
    const separate = included.map((s) => priceFor(s.id));
    if (price != null && separate.every((p) => p != null)) {
      const saving = separate.reduce((a, b) => a + b, 0) - price;
      if (saving > 0) parts.push(`Save ${formatRupees(saving)}`);
    }
    return parts.join(' · ');
  };

  const serviceGroups = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    const matches = q
      ? servicesForVehicle.filter((s) => s.name.toLowerCase().includes(q))
      : servicesForVehicle;
    return SERVICE_GROUP_ORDER.map((group) => ({
      group,
      items: matches.filter((s) => groupForService(s) === group),
    })).filter((g) => g.items.length > 0);
  }, [servicesForVehicle, serviceQuery]);

  const selectedServices = useMemo(
    () => servicesForVehicle.filter((s) => selectedServiceIds.has(s.id)),
    [servicesForVehicle, selectedServiceIds],
  );

  const commissionFor = useCallback(
    (serviceId: string): number =>
      vehicleTypeId
        ? (commissions.find((c) => c.serviceId === serviceId && c.vehicleTypeId === vehicleTypeId)?.amount ?? 0)
        : 0,
    [commissions, vehicleTypeId],
  );
  const commissionTotal = selectedServices.reduce((sum, s) => sum + commissionFor(s.id), 0);
  const pickedSellers: Person[] = sellers ?? (user ? [{ id: user.id, name: user.name }] : []);

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
    setFreeIds(new Set());
    setPlanOrderId(null);
    setSellers(null);
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
    setMake(entry.make ?? null);
    setModel(entry.make ? (entry.model ?? null) : null);
    setManualType(false);
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
    clearModel();
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
    clearModel();
    clearOrder();
    focusSoon(regRef);
  };

  const backToSearch = () => {
    animate();
    for (const p of beforePhotos) void deleteLocalCopy(p.uri);
    setBeforePhotos([]);
    setMode('search');
    setKnown(null);
    setOwnership(null);
    setRegistration('');
    setPhone('');
    setCustomerName('');
    setVehicleTypeId(null);
    setVehiclePickerOpen(false);
    clearModel();
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

  // ---------- Rewards: stamp cards and welcome gift ----------

  const rewardsEnabled = rewardsOn && mode !== 'search';
  const rewardEntry = known && known.registrationNumber === reg ? known : plateEntry;
  const vehicleRewards = useVehicleRewards(reg, rewardEntry, { enabled: rewardsEnabled, online });
  const freeCards = useMemo(
    () => new Map(vehicleRewards.cards.filter((c) => c.free > 0).map((c) => [c.serviceId, c])),
    [vehicleRewards.cards],
  );

  // A free wash belongs to one car and one picked service: drop it when either changes.
  useEffect(() => {
    setFreeIds(new Set());
  }, [reg]);
  useEffect(() => {
    setFreeIds((prev) => {
      const kept = Array.from(prev).filter((id) => selectedServiceIds.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [selectedServiceIds]);

  const freeActiveIds = useMemo(
    () => Array.from(freeIds).filter((id) => selectedServiceIds.has(id) && freeCards.has(id)),
    [freeIds, selectedServiceIds, freeCards],
  );
  const freeActive = freeActiveIds.length > 0;
  const freeSaving = freeActiveIds.reduce((sum, id) => sum + (priceFor(id) ?? 0), 0);

  const freeState = (card: RewardCard): { disabled: boolean; note: string | null } => {
    if (!online) return { disabled: true, note: 'Needs internet to use' };
    if (!selectedVehicle) return { disabled: true, note: 'Pick the vehicle type first' };
    const offered = servicesForVehicle.some((s) => s.id === card.serviceId) && priceFor(card.serviceId) != null;
    if (!offered) return { disabled: true, note: `Not on the ${selectedVehicle.name} menu` };
    const combo = coveredBy.get(card.serviceId);
    if (combo) return { disabled: true, note: `In the ${combo} combo — pick ${card.serviceName} on its own to use it` };
    return { disabled: false, note: null };
  };

  const toggleFree = (card: RewardCard) => {
    animate();
    if (freeIds.has(card.serviceId)) {
      setFreeIds((prev) => {
        const next = new Set(prev);
        next.delete(card.serviceId);
        return next;
      });
      return;
    }
    if (freeState(card).disabled) return;
    // One kind of discount per bill: the free wash replaces a coupon or a typed discount.
    setCouponApplied(false);
    setPlanOrderId(null);
    setDiscountOpen(false);
    setDiscountRupees('');
    setDiscountReason('');
    if (!selectedServiceIds.has(card.serviceId)) toggleService(card.serviceId);
    setFreeIds((prev) => new Set(prev).add(card.serviceId));
  };

  // ---------- Community plan members ----------

  const planPhone = mode !== 'search' && phoneOk && online ? phoneDigits : null;
  useEffect(() => {
    setShopPlans([]);
    setPlanOrderId(null);
    if (!planPhone) return;
    let alive = true;
    api.places['shop-plans']
      .$get({ query: { phone: planPhone } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data) setShopPlans(data.plans);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [planPhone]);

  // Plans bought at this counter belong to the vehicle (its number plate).
  const counterReg = mode !== 'search' && regOk && online ? reg : null;
  const loadCounterPlans = useCallback(async () => {
    if (!counterReg) return setCounterPlans([]);
    try {
      const res = await api['shop-plans'].vehicle.$get({ query: { registrationNumber: counterReg } });
      if (!res.ok) return;
      const body = await res.json();
      setCounterPlans(
        body.plans.map((p) => ({
          orderId: p.orderId,
          placeName: 'Bought at the shop',
          unit: `ends ${new Date(`${p.endsOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
          planName: p.title,
          vehicle: p.vehicle,
          washesUsed: p.washesUsed,
          washesTotal: p.washesTotal,
          service: p.service,
          problem: p.problem,
          source: 'shop' as const,
        })),
      );
    } catch {
      // Offline: no counter plans shown (using one needs internet anyway).
    }
  }, [counterReg]);
  useEffect(() => {
    setCounterPlans([]);
    void loadCounterPlans();
  }, [loadCounterPlans]);

  // A plan belongs to one car: hide plans for the customer's other plates.
  const visiblePlans = useMemo(
    () => [...shopPlans.filter((p) => !p.vehicle.registrationNumber || !regOk || p.vehicle.registrationNumber === reg), ...counterPlans],
    [shopPlans, counterPlans, reg, regOk],
  );

  const planBlocked = (plan: ShopPlan): string | null => {
    if (!online) return 'Needs internet to use';
    if (washMode !== 'hub') return 'Plan washes here are for washes at the shop';
    if (!selectedVehicle) return 'Pick the vehicle size first';
    if (plan.vehicle.typeId !== selectedVehicle.id) return `The plan is for a ${plan.vehicle.typeName}`;
    if (!plan.service) return null;
    const offered = servicesForVehicle.some((s) => s.id === plan.service?.id) && priceFor(plan.service.id) != null;
    if (!offered) return `${plan.service.name} isn’t on the ${selectedVehicle.name} menu`;
    const combo = coveredBy.get(plan.service.id);
    if (combo) return `In the ${combo} combo — pick ${plan.service.name} on its own`;
    return null;
  };

  const activePlan = visiblePlans.find((p) => p.orderId === planOrderId) ?? null;
  const planActive =
    activePlan != null &&
    activePlan.service != null &&
    activePlan.problem == null &&
    planBlocked(activePlan) == null &&
    selectedServiceIds.has(activePlan.service.id);
  const planSaving = planActive && activePlan?.service ? (priceFor(activePlan.service.id) ?? 0) : 0;

  // Unpicking the covered service drops the plan wash with it.
  useEffect(() => {
    if (activePlan?.service && !selectedServiceIds.has(activePlan.service.id)) setPlanOrderId(null);
  }, [selectedServiceIds, activePlan]);

  const togglePlan = (plan: ShopPlan) => {
    animate();
    if (planOrderId === plan.orderId) {
      setPlanOrderId(null);
      return;
    }
    if (plan.problem || planBlocked(plan) || !plan.service) return;
    // One kind of discount per bill: the plan wash replaces every other one.
    setCouponApplied(false);
    setFreeIds(new Set());
    setReferrerPhone('');
    setDiscountOpen(false);
    setDiscountRupees('');
    setDiscountReason('');
    if (!selectedServiceIds.has(plan.service.id)) toggleService(plan.service.id);
    setPlanOrderId(plan.orderId);
  };

  const onGiftGiven = () => {
    vehicleRewards.reload();
    void refreshRewards();
    void refreshStock();
  };

  const welcomeGift =
    rewardsEnabled &&
    vehicleRewards.eligible &&
    vehicleRewards.isNew &&
    (mode === 'known' || (regOk && !server.looking)) &&
    rewardSettings?.gift.length
      ? rewardSettings.gift
      : null;

  const subtotal = breakdown?.subtotal ?? 0;
  const discountTooBig = Boolean(breakdown) && discountPaise > subtotal;
  const discountNeedsReason = discountPaise > 0 && discountReason.trim().length === 0;
  const couponActive = couponApplied && offer != null && !freeActive && !planActive;
  const couponSaving = offer ? couponDiscount(subtotal, offer.percent) : 0;
  // Referrals are for genuinely new customers only: neither the phone nor the plate is on file.
  const isNewCustomer =
    mode === 'form' && !known && regOk && phoneOk && !plateEntry && !phoneEntry && !server.looking;
  const referral = useReferralQuote(referrerPhone, phoneDigits, reg, isNewCustomer && online);
  const referralActive = isNewCustomer && referral.quote != null && !freeActive && !planActive;
  const referralSaving = referral.quote ? couponDiscount(subtotal, referral.quote.percent) : 0;
  const manualDiscount =
    couponActive || referralActive || freeActive || planActive || discountTooBig ? 0 : discountPaise;
  const appliedDiscount = freeActive
    ? freeSaving
    : planActive
      ? planSaving
      : couponActive
      ? couponSaving
      : referralActive
        ? referralSaving
        : manualDiscount;
  // A home visit's charge (the server works it out again and charges it once per visit).
  const visit =
    washMode === 'doorstep' && visitRules && visitPoint && branchPoint
      ? visitCharge(roadKm(distanceKm(branchPoint, visitPoint)), visitRules, new Date())
      : null;
  const needsLocation = washMode === 'doorstep' && visitRules != null && (visitRules.perKmPaise > 0 || visitRules.maxKm < 100);
  const visitAmount = visit && !visit.tooFar && selectedServiceIds.size > 0 ? visit.total : 0;
  const finalTotal = Math.max(0, subtotal - appliedDiscount) + visitAmount;

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
        setFreeIds(new Set());
        setPlanOrderId(null);
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

  // An add-on (Premium Care) is never billed on its own: it goes on top of a wash.
  const onlyAddons = [...selectedServiceIds].every((id) => services.find((s) => s.id === id)?.kind === 'addon');
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
                  : onlyAddons
                    ? 'Add a wash: an add-on goes with a wash'
                  : visit?.tooFar && visitRules
                    ? `Too far: the team goes up to ${visitRules.maxKm} km`
                  : needsLocation && !visitPoint && mode !== 'known'
                    ? 'Turn on location to measure the visit'
                  : !breakdown
                    ? 'A selected service has no price for this vehicle'
                    : freeActive && !online
                      ? 'Free wash needs internet — remove it to save offline'
                      : planOrderId && !planActive && activePlan
                      ? planBlocked(activePlan) ?? 'This plan can’t be used — remove it'
                      : couponActive && !online
                      ? 'Coupon needs internet — remove it to save offline'
                      : isNewCustomer && referral.entered && !referralActive
                        ? referral.checking
                          ? 'Checking the referral…'
                          : 'Fix or remove the referral'
                        : referralActive && !online
                          ? 'Referral needs internet — remove it to save offline'
                          : !couponActive && !referralActive && discountTooBig
                            ? 'Discount is more than the bill'
                            : !couponActive && !referralActive && discountNeedsReason
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
    clearModel();
    setReferrerPhone('');
    setVisitPoint(null);
    setVisitKey((k) => k + 1);
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
      const referralQuote = referralActive ? await referral.ensureFresh() : null;
      if (referralActive && !referralQuote) {
        throw new Error('Couldn’t confirm the referral — check the connection, or remove it.');
      }
      // One offline-safe call: the client id means a retried or queued submission can never
      // create the same wash twice.
      const jobId = newId();
      const result = await submit(
        {
          kind: 'job.start',
          payload: {
            id: jobId,
            occurredAt,
            customer: { phone: phoneDigits, name },
            registrationNumber: reg,
            ownership: conflict && ownership ? ownership : undefined,
            vehicleTypeId,
            make: make && model ? make : undefined,
            model: make && model ? model : undefined,
            services: lineItems,
            quoted: lineItems.flatMap((l) => {
              const price = priceFor(l.serviceId);
              return price == null ? [] : [{ serviceId: l.serviceId, price }];
            }),
            mode: washMode,
            visitPoint: washMode === 'doorstep' && visitPoint ? visitPoint : undefined,
            discount: manualDiscount,
            discountReason: manualDiscount > 0 ? discountReason.trim() : undefined,
            couponCode: couponActive ? offer.code : undefined,
            referralToken: referralQuote?.token,
            rewardServiceIds: freeActive ? freeActiveIds : undefined,
            planOrderId: planActive && activePlan && activePlan.source !== 'shop' ? activePlan.orderId : undefined,
            shopPlanId: planActive && activePlan && activePlan.source === 'shop' ? activePlan.orderId : undefined,
            sellerIds: commissionTotal > 0 ? pickedSellers.map((s) => s.id) : undefined,
          },
          meta: {
            vehicleTypeName: selectedVehicle?.name ?? 'Vehicle',
            vehicleCategory: selectedVehicle?.category ?? 'car',
            vehicleBodyKey: selectedVehicle?.bodyKey ?? null,
            services: [
              ...selectedServices.map((s) => ({
                name: s.name,
                price: priceFor(s.id) ?? 0,
                commission: commissionFor(s.id),
              })),
              ...(visitAmount > 0 ? [{ name: 'Visit charge', price: visitAmount, commission: 0 }] : []),
            ],
            subtotal: subtotal + visitAmount,
            total: finalTotal,
            sellers: commissionTotal > 0 ? pickedSellers : undefined,
          },
        },
        { requireOnline: couponActive || referralActive || freeActive || planActive },
      );
      if (result.status === 'rejected') {
        // The card may have changed (used on another phone, a wash voided): show it as it is now.
        if (freeActive) vehicleRewards.reload();
        if (planActive) setPlanOrderId(null);
        throw new Error(result.message);
      }
      // Queued behind the wash, so each lands once the wash exists (now, or when there's signal).
      const photos = beforePhotos;
      unsentPhotos.current = [];
      for (const photo of photos) {
        await submit({
          kind: 'photo.upload',
          payload: { id: photo.id, jobId, kind: 'before', uri: photo.uri, contentType: photo.contentType, occurredAt },
        });
      }
      setBeforePhotos([]);
      directory.recordVisit({
        registrationNumber: reg,
        vehicleTypeId,
        make: make && model ? make : undefined,
        model: make && model ? model : undefined,
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
          : freeActive
            ? `Wash started for ${firstName} · free ${freeActiveIds.map((id) => freeCards.get(id)?.serviceName).join(' + ')} used`
            : planActive && activePlan
              ? `Wash started for ${firstName} · ${activePlan.washesTotal - activePlan.washesUsed - 1} plan washes left`
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
                {isNewCustomer ? (
                  <ReferralField
                    value={referrerPhone}
                    onChange={setReferrerPhone}
                    state={referral}
                    online={online}
                    saving={referralSaving}
                    formatMoney={formatRupees}
                  />
                ) : null}
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
            summary={selectedVehicle ? (make && model ? `${model} · ${selectedVehicle.name}` : selectedVehicle.name) : null}
            hint={selectedVehicle ? undefined : 'Pick the company and model'}
          />
          {mode === 'known' && selectedVehicle && !vehiclePickerOpen ? (
            <View style={styles.group}>
              <View style={styles.savedVehicle}>
                {make && model ? (
                  <MakeLogo make={make} height={40} />
                ) : (
                  <VehicleArt name={selectedVehicle.name} bodyKey={selectedVehicle.bodyKey} style={styles.savedVehicleImg} />
                )}
                <View style={styles.flex}>
                  <Text style={styles.savedVehicleName}>{make && model ? `${make} ${model}` : selectedVehicle.name}</Text>
                  <Text style={styles.savedVehicleHint}>
                    {make && model ? `${selectedVehicle.name} · ` : ''}
                    {known?.lastVisit ? 'saved from their last visit' : 'saved on their profile'}
                  </Text>
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
              <VehicleModelPicker
                types={vehicleTypes}
                edits={modelEdits}
                make={make}
                model={model}
                onMake={pickMake}
                onPick={pickModel}
              />
              {model && selectedVehicle && !manualType ? (
                <View style={styles.group}>
                  <View style={styles.savedVehicle}>
                    <VehicleArt name={selectedVehicle.name} bodyKey={selectedVehicle.bodyKey} style={styles.savedVehicleImg} />
                    <View style={styles.flex}>
                      <Text style={styles.savedVehicleName}>{selectedVehicle.name}</Text>
                      <Text style={styles.savedVehicleHint}>
                        Picked from the model · {servicesForVehicle.length}{' '}
                        {servicesForVehicle.length === 1 ? 'service' : 'services'} on its menu
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        animate();
                        setManualType(true);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Pick a different vehicle type"
                    >
                      <Text style={styles.linkText}>Change</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {model && manualType && !modelTypeId ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    This branch has no vehicle type for {make} {model}. Pick the closest one below.
                  </Text>
                </View>
              ) : null}
              {!manualType && !(model && selectedVehicle) ? (
                <Pressable
                  onPress={() => {
                    animate();
                    setManualType(true);
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.guideLink, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.guideLinkText}>Model not in the list? Pick the vehicle type yourself ›</Text>
                </Pressable>
              ) : null}
            </>
          )}
          {manualType && !(mode === 'known' && selectedVehicle && !vehiclePickerOpen) ? (
            <>
              <Pressable
                onPress={() => navigation.navigate('VehicleGuide', { category: vehicleFamily === 'bike' ? 'bike' : 'car' })}
                hitSlop={6}
                style={({ pressed }) => [styles.guideLink, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Text style={styles.guideLinkText}>Not sure which size? Look it up in the size guide ›</Text>
              </Pressable>
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
                    No {vehicleFamily === 'bike' ? 'two-wheeler' : 'car'} types here yet. The owner can switch them on in
                    More → Vehicles.
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
          ) : null}

          <BeforePhotos photos={beforePhotos} onChange={setBeforePhotos} />

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
                  : `${selectedVehicle.category === 'bike' ? 'Bike' : 'Car'} menu with ${washMode === 'doorstep' ? 'doorstep ' : ''}prices for ${selectedVehicle.name}`
              }
            />
          </View>

          {modes.length > 1 ? (
            <View style={styles.segmentWrap}>
              <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel="Where the wash happens">
                {WASH_MODES.map((m) => {
                  const on = washMode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => switchWashMode(m.id)}
                      style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {washMode === 'doorstep' && visitRules ? (
            <VisitCard
              key={visitKey}
              rules={visitRules}
              point={visitPoint}
              charge={visit}
              canUseSavedHome={mode === 'known'}
              onPoint={setVisitPoint}
              formatMoney={formatRupees}
            />
          ) : null}

          {rewardsEnabled ? (
            <RewardsPanel
              cards={vehicleRewards.cards}
              freeIds={new Set(freeActiveIds)}
              freeState={freeState}
              onToggleFree={toggleFree}
              giftsOwed={vehicleRewards.giftsOwed}
              giftsOwedCount={vehicleRewards.giftsOwedCount}
              welcome={welcomeGift}
              online={online}
              onGiven={onGiftGiven}
            />
          ) : null}

          {washMode === 'hub' && selectedVehicle && regOk && phoneOk && online && mode !== 'search' ? (
            <Pressable
              onPress={() => setSelling(true)}
              style={({ pressed }) => [styles.sellPlan, pressed && styles.sellPlanPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.sellPlanText}>Sell a plan for {reg}</Text>
            </Pressable>
          ) : null}

          {visiblePlans.map((plan) => (
            <PlanWashCard
              key={plan.orderId}
              plan={plan}
              applied={planActive && activePlan?.orderId === plan.orderId}
              saving={planSaving}
              blocked={planBlocked(plan)}
              formatMoney={formatRupees}
              onToggle={() => togglePlan(plan)}
            />
          ))}

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
                {washMode === 'doorstep'
                  ? `No doorstep services for ${selectedVehicle.name}. Switch to At the shop, or ask the owner to add this vehicle to the doorstep team.`
                  : `No services for ${selectedVehicle.name} yet. The owner can add them in This branch’s prices.`}
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
                        const covered = coveredBy.get(s.id);
                        return (
                          <ServicePickRow
                            key={s.id}
                            name={s.name}
                            group={group}
                            meta={
                              group === 'Combos'
                                ? comboMeta(s, price)
                                : [s.popular ? 'Most popular' : null, s.durationMin ? formatDuration(s.durationMin) : null, s.description?.trim() || null]
                                    .filter(Boolean)
                                    .join(' · ') || null
                            }
                            priceLabel={price != null ? formatRupees(price) : 'No price'}
                            selected={selectedServiceIds.has(s.id)}
                            onPress={() => toggleService(s.id)}
                            showDivider={i < items.length - 1}
                            disabledNote={covered ? 'In combo' : undefined}
                          />
                        );
                      })}
                    </View>
                  </View>
                ))
              )}

              {commissionTotal > 0 && pickedSellers.length > 0 ? (
                <SellerField
                  commission={commissionTotal}
                  sellers={pickedSellers}
                  onChange={(next) => {
                    animate();
                    setSellers(next);
                  }}
                  formatMoney={formatRupees}
                />
              ) : null}

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
              {breakdown && !couponActive && !referralActive && !freeActive && !planActive ? (
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
            subtotal={subtotal + visitAmount}
            discount={appliedDiscount}
            discountLabel={
              freeActive
                ? freeActiveIds.length === 1
                  ? 'free wash'
                  : `${freeActiveIds.length} free washes`
                : planActive
                ? 'plan wash'
                : couponActive
                ? `${offer.percent}% coupon`
                : referralActive && referral.quote
                  ? `${referral.quote.percent}% referral`
                  : undefined
            }
            total={finalTotal}
            missing={missing}
            submitting={submitting}
            onSubmit={() => void startWash()}
          />
        )}
      </KeyboardAvoidingView>
      {selectedVehicle ? (
        <SellPlanSheet
          visible={selling}
          vehicleTypeId={selectedVehicle.id}
          vehicleName={selectedVehicle.name}
          customer={{ phone: phoneDigits, name: customerName.trim() || known?.customerName?.trim() || 'Customer' }}
          registrationNumber={reg}
          ownership={conflict && ownership ? ownership : undefined}
          onClose={() => setSelling(false)}
          onSold={() => void loadCounterPlans()}
          formatMoney={formatRupees}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sellPlan: {
    marginHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.indigoMist,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
  },
  sellPlanPressed: { opacity: 0.7 },
  sellPlanText: { ...typography.label, fontSize: 14, color: colors.indigo, fontWeight: '800' },
  guideLink: { alignSelf: 'flex-start', paddingVertical: 2 },
  guideLinkText: { ...typography.caption, fontSize: 12.5, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
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
