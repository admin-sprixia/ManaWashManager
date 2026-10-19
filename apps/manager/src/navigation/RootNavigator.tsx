import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { JobBoardScreen } from '../screens/JobBoardScreen';
import { NewWashScreen } from '../screens/NewWashScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { HqHomeScreen } from '../screens/HqHomeScreen';
import { TeamScreen } from '../screens/TeamScreen';
import { StaffReportScreen } from '../screens/StaffReportScreen';
import { ExpensesScreen, type ExpenseItem } from '../screens/ExpensesScreen';
import { AddExpenseScreen } from '../screens/AddExpenseScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { CashScreen } from '../screens/CashScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { ErrorLogScreen } from '../screens/ErrorLogScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { AppFeedbackScreen } from '../screens/AppFeedbackScreen';
import { BranchProfileScreen } from '../screens/BranchProfileScreen';
import { BranchVehiclesScreen } from '../screens/BranchVehiclesScreen';
import { ServiceRequestsScreen } from '../screens/ServiceRequestsScreen';
import { ServicePointsScreen } from '../screens/ServicePointsScreen';
import { BusinessScreen } from '../screens/business/BusinessScreen';
import { CatalogServicesScreen } from '../screens/business/CatalogServicesScreen';
import { ServiceEditorScreen } from '../screens/business/ServiceEditorScreen';
import { PlanEditorScreen } from '../screens/business/PlanEditorScreen';
import { VehicleGuideScreen } from '../screens/VehicleGuideScreen';
import { MenuScreen } from '../screens/MenuScreen';
import { PriceListScreen } from '../screens/business/PriceListScreen';
import { PricingRulesScreen } from '../screens/business/PricingRulesScreen';
import { BranchesScreen } from '../screens/business/BranchesScreen';
import { BranchDetailScreen } from '../screens/business/BranchDetailScreen';
import { OpenBranchScreen } from '../screens/business/OpenBranchScreen';
import { AddMemberScreen } from '../screens/places/AddMemberScreen';
import { CommunitiesScreen } from '../screens/places/CommunitiesScreen';
import { CommunitySetupScreen } from '../screens/places/CommunitySetupScreen';
import { PlaceDayScreen } from '../screens/places/PlaceDayScreen';
import { PlaceDemandScreen } from '../screens/places/PlaceDemandScreen';
import { PlaceFormScreen } from '../screens/places/PlaceFormScreen';
import { PlaceLiveScreen } from '../screens/places/PlaceLiveScreen';
import { PlaceScreen } from '../screens/places/PlaceScreen';
import { useAuth } from '../api/auth';
import { colors } from '@mana/ui';
import type { DeliveryMode } from '@mana/domain';

export type RootStackParamList = {
  JobBoard: undefined;
  /** Home for Mana Wash HQ who work at no branch. */
  HqHome: undefined;
  /** `mode`: open on that menu (the home tab it was started from), when the branch offers it. */
  NewWash: { registration?: string; mode?: DeliveryMode } | undefined;
  JobDetail: { jobId: string };
  CustomerProfile: { customerId: string };
  More: undefined;
  /** `added`: the date of an expense just saved, so the list shows the period it falls in. */
  Expenses: { added?: string } | undefined;
  AddExpense: { edit?: ExpenseItem } | undefined;
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
  ServiceRequests: undefined;
  /** The owner's branch details: name, contact, hours, holiday, location, the app's area. */
  BranchProfile: undefined;
  BranchVehicles: undefined;
  AppFeedback: { tab?: 'problems' | 'vehicles' | 'ratings' } | undefined;
  ServicePoints: undefined;
  Business: undefined;
  BusinessServices: { tab?: 'services' | 'plans' } | undefined;
  /** Add (no id) or edit one business service. */
  BusinessServiceEdit: { serviceId?: string } | undefined;
  /** Add (no id) or edit one wash plan. */
  BusinessPlanEdit: { planId?: string } | undefined;
  /** Which size every vehicle is priced as; opened on a tab or size. */
  VehicleGuide: { category?: 'car' | 'bike'; size?: string } | undefined;
  /** The branch's hub, community and doorstep menus, for every vehicle or one; shared as a PDF. */
  Menu: undefined;
  BusinessPrices: undefined;
  BusinessRules: undefined;
  BusinessBranches: undefined;
  OpenBranch: undefined;
  BusinessBranch: { branchId: string };
  Communities: undefined;
  Place: { placeId: string };
  /** A new community, or a draft/live one's inspection. `at`/`label`: prefilled from where people are asking. */
  CommunitySetup: { placeId?: string; at?: { latitude: number; longitude: number }; label?: string; name?: string } | undefined;
  /** The owner reviews a draft and makes it live, or changes a live community's wash settings. */
  PlaceForm: { placeId: string };
  /** Shown once, straight after a community is approved. */
  PlaceLive: { placeId: string; invited: number };
  PlaceDay: { placeId: string; day?: string };
  AddMember: { placeId: string };
  PlaceDemand: undefined;
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

/** Mana Wash HQ who work at no branch: HQ's home and tools only, no branch screens at all. */
function HqOnlyNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName="HqHome" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="HqHome" component={HqHomeScreen} />
        <Stack.Screen name="Business" component={BusinessScreen} options={slide} />
        <Stack.Screen name="BusinessServices" component={CatalogServicesScreen} options={slide} />
        <Stack.Screen name="BusinessServiceEdit" component={ServiceEditorScreen} options={slide} />
        <Stack.Screen name="BusinessPlanEdit" component={PlanEditorScreen} options={slide} />
        <Stack.Screen name="VehicleGuide" component={VehicleGuideScreen} options={slide} />
        <Stack.Screen name="BusinessPrices" component={PriceListScreen} options={slide} />
        <Stack.Screen name="BusinessRules" component={PricingRulesScreen} options={slide} />
        <Stack.Screen name="BusinessBranches" component={BranchesScreen} options={slide} />
        <Stack.Screen name="OpenBranch" component={OpenBranchScreen} options={slide} />
        <Stack.Screen name="BusinessBranch" component={BranchDetailScreen} options={slide} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export function RootNavigator() {
  const { isOwner, canManageTeam, hqOnly } = useAuth();

  if (hqOnly) return <HqOnlyNavigator />;
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
        <Stack.Screen name="AddExpense" component={AddExpenseScreen} options={slide} />
        <Stack.Screen name="Reminders" component={RemindersScreen} options={slide} />
        <Stack.Screen name="Cash" component={CashScreen} options={slide} />
        <Stack.Screen name="Inventory" component={InventoryScreen} options={slide} />
        <Stack.Screen name="Rewards" component={RewardsScreen} options={slide} />
        <Stack.Screen name="ServiceRequests" component={ServiceRequestsScreen} options={slide} />
        <Stack.Screen name="AppFeedback" component={AppFeedbackScreen} options={slide} />
        <Stack.Screen name="Menu" component={MenuScreen} options={slide} />
        {/* Business admins are picked by phone, so the API decides who may use these. */}
        <Stack.Screen name="Business" component={BusinessScreen} options={slide} />
        <Stack.Screen name="BusinessServices" component={CatalogServicesScreen} options={slide} />
        <Stack.Screen name="BusinessServiceEdit" component={ServiceEditorScreen} options={slide} />
        <Stack.Screen name="BusinessPlanEdit" component={PlanEditorScreen} options={slide} />
        <Stack.Screen name="VehicleGuide" component={VehicleGuideScreen} options={slide} />
        <Stack.Screen name="BusinessPrices" component={PriceListScreen} options={slide} />
        <Stack.Screen name="BusinessRules" component={PricingRulesScreen} options={slide} />
        <Stack.Screen name="BusinessBranches" component={BranchesScreen} options={slide} />
        <Stack.Screen name="OpenBranch" component={OpenBranchScreen} options={slide} />
        <Stack.Screen name="BusinessBranch" component={BranchDetailScreen} options={slide} />
        {/* Anyone can inspect and draft a community and work its wash days; the owner approves. */}
        <Stack.Screen name="Communities" component={CommunitiesScreen} options={slide} />
        <Stack.Screen name="CommunitySetup" component={CommunitySetupScreen} options={slide} />
        <Stack.Screen name="Place" component={PlaceScreen} options={slide} />
        <Stack.Screen name="PlaceDay" component={PlaceDayScreen} options={slide} />
        <Stack.Screen name="AddMember" component={AddMemberScreen} options={slide} />
        <Stack.Screen name="PlaceDemand" component={PlaceDemandScreen} options={slide} />
        {/* Screens a role can't use aren't even registered for it — the API enforces the same
            rules, this just keeps them out of reach in the UI. Managers run the team and its
            attendance only. */}
        {canManageTeam ? (
          <>
            <Stack.Screen name="Team" component={TeamScreen} options={slide} />
            <Stack.Screen name="Attendance" component={AttendanceScreen} options={slide} />
          </>
        ) : null}
        {isOwner ? (
          <>
            <Stack.Screen name="Reports" component={ReportsScreen} options={slide} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={slide} />
            <Stack.Screen name="StaffReport" component={StaffReportScreen} options={slide} />
            <Stack.Screen name="ErrorLog" component={ErrorLogScreen} options={slide} />
            <Stack.Screen name="BranchProfile" component={BranchProfileScreen} options={slide} />
            <Stack.Screen name="BranchVehicles" component={BranchVehiclesScreen} options={slide} />
            <Stack.Screen name="ServicePoints" component={ServicePointsScreen} options={slide} />
            <Stack.Screen name="PlaceForm" component={PlaceFormScreen} options={slide} />
            <Stack.Screen name="PlaceLive" component={PlaceLiveScreen} options={{ ...slide, gestureEnabled: false }} />
          </>
        ) : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
