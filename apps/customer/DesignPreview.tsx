// TEMPORARY: renders Home with mock data so the design can be checked on an emulator. Not part of the app.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost, colors } from '@mana/ui';
import { FloatingTabBar } from './src/components/FloatingTabBar';
import { HomeView, type HomeViewProps } from './src/screens/HomeView';

const wash = (over: object = {}) =>
  ({
    id: 'w1', status: 'paid', services: [{ name: 'Exterior Wash', quantity: 1 }], total: 25000,
    createdAt: '2026-09-28T13:25:00+05:30', photoCount: 3, vehicle: { registrationNumber: 'AP39GB7534' }, ...over,
  }) as never;
const live = (status: string, over: object = {}) =>
  ({
    id: 'l1', status, ahead: 0, total: status === 'ready' ? 45000 : 25000,
    services: [{ name: status === 'ready' ? 'Complete Car Wash' : 'Exterior Wash', quantity: 1 }],
    vehicle: { registrationNumber: 'AP39GB7534' }, branch: { id: 'b1' }, ...over,
  }) as never;
const vehicle = (cards: object[], offers: object[] = [], gifts: object[] = []) =>
  ({ registrationNumber: 'AP39GB7534', cards, offers, giftsOwed: gifts }) as never;
const offer = { code: 'MANA-7534-ZVKTRE', percent: 6, expiresAt: '2026-10-19T00:00:00Z' };

const BASE: HomeViewProps = {
  greeting: 'Good morning', firstName: 'Rohit', branchLine: 'MANA Car Wash, Nellore', referralOffer: '5–10% off',
  now: new Date('2026-10-05T10:04:00+05:30'), latest: wash(), vehicles: [], liveWashes: [],
  branchOf: () => ({ phone: '9876543210', address: 'Nellore' }) as never,
  loading: false, refreshing: false, error: null, hasData: true, focused: true,
  onRefresh: () => undefined, onRetry: () => undefined, onProfile: () => undefined, onOpenWash: () => undefined,
  onSeeAllWashes: () => undefined, onInvite: () => undefined, onHelp: () => undefined,
};
const card = (stamps: number, free = 0, extra: object = {}) => ({ serviceName: 'Complete Car Wash', stamps, every: 5, free, expiresAt: null, ...extra });

const STATES: Record<string, Partial<HomeViewProps>> = {
  default: { vehicles: [vehicle([card(4)], [offer])] },
  washing: { liveWashes: [live('washing')], latest: wash({ id: 'l1' }), vehicles: [vehicle([card(4)])] },
  ready: {
    liveWashes: [live('ready')], latest: wash({ id: 'l1' }),
    vehicles: [vehicle([card(5, 1, { expiresAt: '2026-10-11T00:00:00Z' })], [offer], [{ itemName: 'Car perfume', quantity: 1, unit: 'pcs' }])],
  },
  fresh: { firstName: 'Asha', latest: null, vehicles: [] },
  loading: { loading: true, hasData: false, latest: null },
  error: { error: 'Check your connection and try again.', hasData: false, latest: null },
};
const ORDER = Object.keys(STATES);

const Tab = createBottomTabNavigator();
const Placeholder = ({ name }: { name: string }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
    <Text style={{ color: colors.slateDeep }}>{name}</Text>
  </View>
);

export default function DesignPreview() {
  const [i, setI] = React.useState(0);
  const Home = React.useCallback(() => <HomeView {...BASE} {...STATES[ORDER[i]!]} />, [i]);
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.surface } }}>
        <Tab.Navigator tabBar={(p) => <FloatingTabBar {...p} />} screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Home" component={Home} />
          <Tab.Screen name="Washes" children={() => <Placeholder name="Washes" />} />
          <Tab.Screen name="Vehicles" children={() => <Placeholder name="Vehicles" />} />
          <Tab.Screen name="Visit" options={{ title: 'Visit us' }} children={() => <Placeholder name="Visit" />} />
          <Tab.Screen name="Profile" children={() => <Placeholder name="Profile" />} />
        </Tab.Navigator>
      </NavigationContainer>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, width: 56, height: 56 }} onPress={() => setI((n) => (n + 1) % ORDER.length)} />
      <ToastHost />
    </SafeAreaProvider>
  );
}
