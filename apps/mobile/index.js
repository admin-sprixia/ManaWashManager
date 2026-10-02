/**
 * @format
 */
// Must be the very first import: Hermes (React Native's JS engine) ships only a partial
// URL/URLSearchParams stub — e.g. URLSearchParams.set throws "not implemented" — which
// breaks Hono's client (it builds query strings with URLSearchParams). This patches the
// globals with a real implementation before anything else runs.
import 'react-native-url-polyfill/auto';
// Hermes has no crypto.getRandomValues; this backs it with the OS's secure random source.
// Offline record ids and anything else random on the phone rely on it (see src/utils/id.ts).
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
