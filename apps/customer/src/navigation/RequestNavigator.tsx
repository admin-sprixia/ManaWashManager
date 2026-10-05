import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RequestPass } from '../api/session';
import { RequestFormScreen } from '../screens/request/RequestFormScreen';
import { RequestHomeScreen } from '../screens/request/RequestHomeScreen';
import type { RequestStackParams } from './types';

const Stack = createNativeStackNavigator<RequestStackParams>();

/** A number that isn't a customer yet: its request, and the form to make or change one. */
export function RequestNavigator({ pass }: { pass: RequestPass }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RequestHome">{(props) => <RequestHomeScreen {...props} pass={pass} />}</Stack.Screen>
      <Stack.Screen name="RequestForm">{(props) => <RequestFormScreen {...props} pass={pass} />}</Stack.Screen>
    </Stack.Navigator>
  );
}
