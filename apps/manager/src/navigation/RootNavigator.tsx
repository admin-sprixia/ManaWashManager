import React, { useEffect } from 'react';
import {
  createNavigationContainerRef,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
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
import { CashScreen } from '../screens/CashScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { ErrorLogScreen } from '../screens/ErrorLogScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { PlanScreen } from '../screens/PlanScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { AppFeedbackScreen } from '../screens/AppFeedbackScreen';
import { ServiceAreaScreen } from '../screens/ServiceAreaScreen';
import { ServiceRequestsScreen } from '../screens/ServiceRequestsScreen';
import { ServicePointsScreen } from '../screens/ServicePointsScreen';
import { BusinessScreen } from '../screens/business/BusinessScreen';
import { CatalogServicesScreen } from '../screens/business/CatalogServicesScreen';
import { PriceListScreen } from '../screens/business/PriceListScreen';
import { PricingRulesScreen } from '../screens/business/PricingRulesScreen';
import { VehicleSizesScreen } from '../screens/business/VehicleSizesScreen';
import { BranchesScreen } from '../screens/business/BranchesScreen';
import { WashPlansScreen } from '../screens/business/WashPlansScreen';
import { AddMemberScreen } from '../screens/places/AddMemberScreen';
import { CommunitiesScreen } from '../screens/places/CommunitiesScreen';
import { CommunitySetupScreen } from '../screens/places/CommunitySetupScreen';
import { PlaceDayScreen } from '../screens/places/PlaceDayScreen';
import { PlaceDemandScreen } from '../screens/places/PlaceDemandScreen';
import { PlaceFormScreen } from '../screens/places/PlaceFormScreen';
import { PlaceScreen } from '../screens/places/PlaceScreen';
import { setOpenPlans, UpgradeHost } from '../components/UpgradeSheet';
import { useAuth } from '../api/auth';
import { colors } from '@mana/ui';

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
  Cash: { date?: string } | undefined;
  Attendance: undefined;
  ErrorLog: undefined;
  Inventory: undefined;
  Rewards: undefined;
  Plan: undefined;
  ServiceRequests: undefined;
  ServiceArea: undefined;
  AppFeedback: { tab?: 'problems' | 'vehicles' | 'ratings' } | undefined;
  ServicePoints: undefined;
  Business: undefined;
  BusinessServices: undefined;
  BusinessPrices: undefined;
  BusinessRules: undefined;
  BusinessVehicles: undefined;
  BusinessBranches: undefined;
  WashPlans: undefined;
  Communities: undefined;
  Place: { placeId: string };
  /** A new community, or a draft/live one's inspection. `at`/`label`: prefilled from where people are asking. */
  CommunitySetup: { placeId?: string; at?: { latitude: number; longitude: number }; label?: string; name?: string } | undefined;
  /** The owner reviews a draft and makes it live, or changes a live community's wash settings. */
  PlaceForm: { placeId: string };
  PlaceDay: { placeId: string; day?: string };
  AddMember: { placeId: string };
  PlaceDemand: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

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

  // The upgrade sheet opens from anywhere; only the owner has a plan screen to send it to.
  useEffect(() => {
    setOpenPlans(isOwner ? () => navigationRef.isReady() && navigationRef.navigate('Plan') : null);
    return () => setOpenPlans(null);
  }, [isOwner]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
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
        <Stack.Screen name="Cash" component={CashScreen} options={slide} />
        <Stack.Screen name="Inventory" component={InventoryScreen} options={slide} />
        <Stack.Screen name="Rewards" component={RewardsScreen} options={slide} />
        <Stack.Screen name="ServiceRequests" component={ServiceRequestsScreen} options={slide} />
        <Stack.Screen name="AppFeedback" component={AppFeedbackScreen} options={slide} />
        {/* Business admins are picked by phone, so the API decides who may use these. */}
        <Stack.Screen name="Business" component={BusinessScreen} options={slide} />
        <Stack.Screen name="BusinessServices" component={CatalogServicesScreen} options={slide} />
        <Stack.Screen name="BusinessPrices" component={PriceListScreen} options={slide} />
        <Stack.Screen name="BusinessRules" component={PricingRulesScreen} options={slide} />
        <Stack.Screen name="BusinessVehicles" component={VehicleSizesScreen} options={slide} />
        <Stack.Screen name="BusinessBranches" component={BranchesScreen} options={slide} />
        <Stack.Screen name="WashPlans" component={WashPlansScreen} options={slide} />
        {/* Anyone can inspect and draft a community and work its wash days; the owner approves. */}
        <Stack.Screen name="Communities" component={CommunitiesScreen} options={slide} />
        <Stack.Screen name="CommunitySetup" component={CommunitySetupScreen} options={slide} />
        <Stack.Screen name="Place" component={PlaceScreen} options={slide} />
        <Stack.Screen name="PlaceDay" component={PlaceDayScreen} options={slide} />
        <Stack.Screen name="AddMember" component={AddMemberScreen} options={slide} />
        <Stack.Screen name="PlaceDemand" component={PlaceDemandScreen} options={slide} />
        {/* Owner-only screens aren't even registered for staff — the API enforces the same
            rules, this just keeps them out of reach in the UI. */}
        {isOwner ? (
          <>
            <Stack.Screen name="Reports" component={ReportsScreen} options={slide} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={slide} />
            <Stack.Screen name="Team" component={TeamScreen} options={slide} />
            <Stack.Screen name="StaffReport" component={StaffReportScreen} options={slide} />
            <Stack.Screen name="Attendance" component={AttendanceScreen} options={slide} />
            <Stack.Screen name="ErrorLog" component={ErrorLogScreen} options={slide} />
            <Stack.Screen name="Plan" component={PlanScreen} options={slide} />
            <Stack.Screen name="ServiceArea" component={ServiceAreaScreen} options={slide} />
            <Stack.Screen name="ServicePoints" component={ServicePointsScreen} options={slide} />
            <Stack.Screen name="PlaceForm" component={PlaceFormScreen} options={slide} />
          </>
        ) : null}
      </Stack.Navigator>
      <UpgradeHost />
    </NavigationContainer>
  );
}
