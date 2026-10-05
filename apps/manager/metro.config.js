const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

// Metro needs to see across the monorepo (packages/domain, packages/db, apps/api)
// since they're imported as workspace packages, not published npm packages.
const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

// pdf-lib (and other TS libs) import `tslib` helpers like `__extends`. Metro + Hermes
// break on tslib's CJS/UMD default export — force the plain ES6 build instead.
const tslibEs6 = path.resolve(workspaceRoot, 'node_modules/tslib/tslib.es6.js');

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
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'tslib') {
        return { type: 'sourceFile', filePath: tslibEs6 };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
