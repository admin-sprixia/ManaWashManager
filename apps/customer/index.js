// Must be the very first import: Hermes ships only a partial URL/URLSearchParams, which breaks
// Hono's client (it builds query strings with URLSearchParams).
import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
