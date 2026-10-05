#!/usr/bin/env node
/**
 * Points release builds at the deployed API.
 *
 *   npm run set-api-url -- https://mana-api.<your-subdomain>.workers.dev
 *
 * The URL is checked by calling its /health endpoint first, so a typo can't ship.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../src/config/release.json', import.meta.url));
const url = (process.argv[2] ?? '').replace(/\/+$/, '');

if (!/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(url)) {
  console.error('Pass the full https:// address of the deployed API, e.g.\n  npm run set-api-url -- https://mana-api.example.workers.dev');
  process.exit(1);
}

try {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true) throw new Error(`answered ${res.status}`);
} catch (e) {
  console.error(`${url}/health didn’t answer like the MANA API (${e instanceof Error ? e.message : e}).`);
  console.error('Deploy first (npm run deploy in apps/api), then use the address it prints.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(file, 'utf8'));
config.productionApiUrl = url;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Release builds will use ${url}`);
