import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AlertHost, SplashIntro, ToastHost, colors } from '@mana/ui';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { holdIncomingLinks } from './src/navigation/linking';
import { MainNavigator, mainLinking } from './src/navigation/MainNavigator';
import { RequestNavigator, requestLinking } from './src/navigation/RequestNavigator';
import { SignInScreen } from './src/screens/SignInScreen';

const theme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.water,
    background: colors.surface,
    card: colors.white,
    text: colors.waterInk,
    border: colors.border,
  },
};

function Body() {
  const { state } = useAuth();
  const navigable = state.kind === 'requesting' || state.kind === 'signed_in';
  useEffect(() => (navigable ? undefined : holdIncomingLinks()), [navigable]);
  switch (state.kind) {
    case 'checking':
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.water} size="large" />
        </View>
      );
    case 'signed_out':
      return <SignInScreen notice={state.notice} />;
    case 'requesting':
      return (
        <NavigationContainer theme={theme} linking={requestLinking} key={`request:${state.pass.phone}`}>
          <RequestNavigator pass={state.pass} />
        </NavigationContainer>
      );
    case 'signed_in':
      return (
        <NavigationContainer theme={theme} linking={mainLinking} key={`customer:${state.account.phone}`}>
          <MainNavigator />
        </NavigationContainer>
      );
  }
}

export default function App() {
  // The opening animation plays once per launch. The app mounts underneath once its lines are drawn
  // (see SplashIntro), and the splash then fades away over it.
  const [splash, setSplash] = useState(true);
  const [revealed, setRevealed] = useState(false);
  return (
    // initialMetrics lets the first frame render at once, so nothing blank shows before the splash.
    <SafeAreaProvider style={styles.root} initialMetrics={initialWindowMetrics}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      {revealed ? (
        <AuthProvider>
          <ErrorBoundary>
            <Body />
          </ErrorBoundary>
          <ToastHost />
          <AlertHost />
        </AuthProvider>
      ) : null}
      {splash ? (
        <SplashIntro product="WASH" onReveal={() => setRevealed(true)} onDone={() => setSplash(false)} />
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // The launch window is the splash's indigo gradient; screens sit on white.
  root: { backgroundColor: colors.white },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
});
