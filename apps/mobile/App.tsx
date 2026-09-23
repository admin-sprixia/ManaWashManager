import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './src/screens/LoginScreen';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider, useAuth } from './src/api/auth';
import { colors } from './src/theme';

function AppBody() {
  const { checking, loggedIn, signIn, bootstrap } = useAuth();

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

  return loggedIn ? <RootNavigator /> : <LoginScreen onLoggedIn={signIn} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppBody />
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
