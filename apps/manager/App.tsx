import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './src/screens/LoginScreen';
import { CreatePinScreen } from './src/screens/CreatePinScreen';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider, useAuth } from './src/api/auth';
import { SyncProvider } from './src/offline/SyncProvider';
import { DirectoryProvider } from './src/offline/DirectoryProvider';
import { ShopProvider } from './src/offline/ShopProvider';
import { PlanProvider } from './src/offline/PlanProvider';
import { ToastHost, AlertHost, colors } from '@mana/ui';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { installGlobalErrorHandler } from './src/utils/errorReporter';

installGlobalErrorHandler();

function AppBody() {
  const { checking, loggedIn, user, bootstrap } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.water} size="large" />
      </View>
    );
  }

  if (!loggedIn) return <LoginScreen />;
  // A PIN is the only way back in, so it's set before anything else opens.
  if (!user?.hasPin) return <CreatePinScreen />;
  return <RootNavigator />;
}

/** Everything inside holds one shop's data, so opening another branch (a new account) starts it fresh. */
function ShopScope({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <React.Fragment key={user?.id ?? 'signed-out'}>{children}</React.Fragment>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ShopScope>
          <SyncProvider>
            <DirectoryProvider>
              <ShopProvider>
                <PlanProvider>
                  <ErrorBoundary>
                    <AppBody />
                  </ErrorBoundary>
                </PlanProvider>
              </ShopProvider>
            </DirectoryProvider>
          </SyncProvider>
        </ShopScope>
        <ToastHost />
        <AlertHost />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
});
