import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { JobBoardScreen } from '../screens/JobBoardScreen';
import { NewWashScreen } from '../screens/NewWashScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme';

export type RootStackParamList = {
  JobBoard: undefined;
  NewWash: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.white,
    primary: colors.water,
    text: colors.waterInk,
    border: colors.border,
    card: colors.white,
  },
};

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="JobBoard"
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTintColor: colors.water,
          headerTitleStyle: { color: colors.waterInk },
        }}
      >
        <Stack.Screen name="JobBoard" component={JobBoardScreen} options={{ title: 'MANA' }} />
        <Stack.Screen name="NewWash" component={NewWashScreen} options={{ title: 'New Wash' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
