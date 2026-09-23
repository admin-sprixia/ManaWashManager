import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { JobBoardScreen } from '../screens/JobBoardScreen';
import { NewWashScreen } from '../screens/NewWashScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { colors } from '../theme';

export type RootStackParamList = {
  JobBoard: undefined;
  NewWash: undefined;
  Settings: undefined;
  CustomerProfile: { customerId: string };
  Reports: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.surface,
    primary: colors.water,
    text: colors.waterInk,
    border: colors.border,
    card: colors.white,
  },
};

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      {/* headerShown: false — every screen now owns its full header treatment (a GradientHero
          for Login/Job Board, a ScreenHeader for New Wash/Settings), so the native stack
          header would just duplicate it. */}
      <Stack.Navigator initialRouteName="JobBoard" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="JobBoard" component={JobBoardScreen} />
        <Stack.Screen name="NewWash" component={NewWashScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="CustomerProfile"
          component={CustomerProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="Reports" component={ReportsScreen} options={{ animation: 'slide_from_right' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
