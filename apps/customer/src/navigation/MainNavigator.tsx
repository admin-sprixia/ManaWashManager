import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BranchesProvider } from '../branches/BranchesProvider';
import { FloatingTabBar } from '../components/FloatingTabBar';
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

/** A signed-in customer: the tabs, and the screens they open. */
export function MainNavigator() {
  return (
    <BranchesProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
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
    </BranchesProvider>
  );
}
