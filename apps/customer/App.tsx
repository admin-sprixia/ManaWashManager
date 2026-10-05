import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertHost, ToastHost, colors } from '@mana/ui';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { MainNavigator } from './src/navigation/MainNavigator';
import { RequestNavigator } from './src/navigation/RequestNavigator';
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
        <NavigationContainer theme={theme} key={`request:${state.pass.phone}`}>
          <RequestNavigator pass={state.pass} />
        </NavigationContainer>
      );
    case 'signed_in':
      return (
        <NavigationContainer theme={theme} key={`customer:${state.account.phone}`}>
          <MainNavigator />
        </NavigationContainer>
      );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <AuthProvider>
        <ErrorBoundary>
          <Body />
        </ErrorBoundary>
        <ToastHost />
        <AlertHost />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
});
