/**
 * @format
 */
// Must be the very first import: Hermes (React Native's JS engine) ships only a partial
// URL/URLSearchParams stub — e.g. URLSearchParams.set throws "not implemented" — which
// breaks Hono's client (it builds query strings with URLSearchParams). This patches the
// globals with a real implementation before anything else runs.
import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
