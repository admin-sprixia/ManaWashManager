import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LoginScreen } from './src/screens/LoginScreen';
import { RootNavigator } from './src/navigation/RootNavigator';
import { getSessionToken } from './src/api/session';
import { colors } from './src/theme';

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    void (async () => {
      const token = await getSessionToken();
      setLoggedIn(Boolean(token));
      setCheckingSession(false);
    })();
  }, []);

  if (checkingSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.water} size="large" />
      </View>
    );
  }

  return loggedIn ? <RootNavigator /> : <LoginScreen onLoggedIn={() => setLoggedIn(true)} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
});
