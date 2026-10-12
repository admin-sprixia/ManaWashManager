import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RequestPass } from '../api/session';
import { JoinModeProvider, type JoinMode } from '../places/joinMode';
import { FindPlaceScreen } from '../screens/places/FindPlaceScreen';
import { JoinPlaceScreen } from '../screens/places/JoinPlaceScreen';
import { RequestFormScreen } from '../screens/request/RequestFormScreen';
import { RequestHomeScreen } from '../screens/request/RequestHomeScreen';
import { linkingFor } from './linking';
import type { RequestStackParams } from './types';

const Stack = createNativeStackNavigator<RequestStackParams>();

export const requestLinking = linkingFor<RequestStackParams>({
  RequestHome: 'home',
  JoinPlace: 'place/:code',
});

/**
 * A number that isn't a customer yet: finding and joining their place (which makes them one),
 * or asking the team to call back, and that request.
 */
export function RequestNavigator({ pass }: { pass: RequestPass }) {
  const mode = useMemo<JoinMode>(() => ({ kind: 'ticket', pass }), [pass]);
  return (
    <JoinModeProvider mode={mode}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="RequestHome">{(props) => <RequestHomeScreen {...props} pass={pass} />}</Stack.Screen>
        <Stack.Screen name="RequestForm">{(props) => <RequestFormScreen {...props} pass={pass} />}</Stack.Screen>
        <Stack.Screen name="FindPlace" component={FindPlaceScreen} />
        <Stack.Screen name="JoinPlace" component={JoinPlaceScreen} />
      </Stack.Navigator>
    </JoinModeProvider>
  );
}
