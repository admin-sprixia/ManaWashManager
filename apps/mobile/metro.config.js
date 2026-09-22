const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

// Metro needs to see across the monorepo (packages/domain, packages/db, apps/api)
// since they're imported as workspace packages, not published npm packages.
const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

/** @type {import('metro-config').MetroConfig} */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // Hono's client (and some other modern packages) resolve only via package.json
    // "exports" maps — Metro doesn't follow those by default.
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
