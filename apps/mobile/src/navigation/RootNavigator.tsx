import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { JobBoardScreen } from '../screens/JobBoardScreen';
import { NewWashScreen } from '../screens/NewWashScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { TeamScreen } from '../screens/TeamScreen';
import { StaffReportScreen } from '../screens/StaffReportScreen';
import { ExpensesScreen } from '../screens/ExpensesScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { useAuth } from '../api/auth';
import { colors } from '../theme';

export type RootStackParamList = {
  JobBoard: undefined;
  NewWash: { registration?: string } | undefined;
  JobDetail: { jobId: string };
  CustomerProfile: { customerId: string };
  More: undefined;
  Expenses: undefined;
  Settings: undefined;
  Reports: undefined;
  Team: undefined;
  StaffReport: undefined;
  Reminders: undefined;
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

const slide = { animation: 'slide_from_right' as const };

export function RootNavigator() {
  const { isOwner } = useAuth();

  return (
    <NavigationContainer theme={navTheme}>
      {/* headerShown: false — every screen owns its full header treatment (a GradientHero
          for the Job Board, a ScreenHeader elsewhere), so the native stack header would
          just duplicate it. */}
      <Stack.Navigator initialRouteName="JobBoard" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="JobBoard" component={JobBoardScreen} />
        <Stack.Screen name="NewWash" component={NewWashScreen} options={slide} />
        <Stack.Screen name="JobDetail" component={JobDetailScreen} options={slide} />
        <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} options={slide} />
        <Stack.Screen name="More" component={MoreScreen} options={slide} />
        <Stack.Screen name="Expenses" component={ExpensesScreen} options={slide} />
        <Stack.Screen name="Reminders" component={RemindersScreen} options={slide} />
        {/* Owner-only screens aren't even registered for staff — the API enforces the same
            rules, this just keeps them out of reach in the UI. */}
        {isOwner ? (
          <>
            <Stack.Screen name="Reports" component={ReportsScreen} options={slide} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={slide} />
            <Stack.Screen name="Team" component={TeamScreen} options={slide} />
            <Stack.Screen name="StaffReport" component={StaffReportScreen} options={slide} />
          </>
        ) : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
