import React, { useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BranchesProvider } from '../branches/BranchesProvider';
import { FloatingTabBar } from '../components/FloatingTabBar';
import { JoinModeProvider, type JoinMode } from '../places/joinMode';
import { takePendingJoin } from '../places/pendingJoin';
import { FindPlaceScreen } from '../screens/places/FindPlaceScreen';
import { JoinPlaceScreen } from '../screens/places/JoinPlaceScreen';
import { JoinResultScreen } from '../screens/places/JoinResultScreen';
import { MyPlaceScreen } from '../screens/places/MyPlaceScreen';
import { PaymentScreen } from '../screens/places/PaymentScreen';
import { PlanScreen } from '../screens/places/PlanScreen';
import { ReceiptScreen } from '../screens/places/ReceiptScreen';
import { linkingFor } from './linking';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PhotoScreen } from '../screens/PhotoScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ReferScreen } from '../screens/ReferScreen';
import { ReportProblemScreen } from '../screens/ReportProblemScreen';
import { VehiclesScreen } from '../screens/VehiclesScreen';
import { VisitScreen } from '../screens/VisitScreen';
import { WashDetailScreen } from '../screens/WashDetailScreen';
import { WashesScreen } from '../screens/WashesScreen';
import type { MainStackParams, TabParams } from './types';

const Tab = createBottomTabNavigator<TabParams>();
const Stack = createNativeStackNavigator<MainStackParams>();

function Tabs() {
  return (
    <Tab.Navigator tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Washes" component={WashesScreen} />
      <Tab.Screen name="Vehicles" component={VehiclesScreen} />
      <Tab.Screen name="Visit" component={VisitScreen} options={{ title: 'Visit us' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const CUSTOMER: JoinMode = { kind: 'customer' };

export const mainLinking = linkingFor<MainStackParams>({
  Tabs: { screens: { Home: 'home' } },
  JoinPlace: 'place/:code',
  Payment: 'payment/:paymentId',
});

/** A signed-in customer: the tabs, and the screens they open. */
export function MainNavigator() {
  // Right after a new number joins: open on "You're in!" instead of Home.
  const [pending] = useState(takePendingJoin);
  return (
    <BranchesProvider>
      <JoinModeProvider mode={CUSTOMER}>
        <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={pending ? 'JoinResult' : 'Tabs'}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="FindPlace" component={FindPlaceScreen} />
          <Stack.Screen name="JoinPlace" component={JoinPlaceScreen} />
          <Stack.Screen name="JoinResult" component={JoinResultScreen} initialParams={pending ?? undefined} options={{ gestureEnabled: false }} />
          <Stack.Screen name="MyPlace" component={MyPlaceScreen} />
          <Stack.Screen name="Plan" component={PlanScreen} />
          <Stack.Screen name="Payment" component={PaymentScreen} />
          <Stack.Screen name="Receipt" component={ReceiptScreen} />
          <Stack.Screen name="WashDetail" component={WashDetailScreen} />
          <Stack.Screen
            name="Photo"
            component={PhotoScreen}
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen name="ReportProblem" component={ReportProblemScreen} />
          <Stack.Screen name="Help" component={HelpScreen} />
          <Stack.Screen name="AddVehicle" component={AddVehicleScreen} />
          <Stack.Screen name="Refer" component={ReferScreen} />
        </Stack.Navigator>
      </JoinModeProvider>
    </BranchesProvider>
  );
}
