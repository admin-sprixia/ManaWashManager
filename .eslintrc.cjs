module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Not tsconfig.base.json: it has no "include", so it would claim every file and lint the
    // Worker without @cloudflare/workers-types.
    project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'],
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
  overrides: [
    {
      files: ['apps/manager/**/*.{ts,tsx}', 'apps/customer/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
      plugins: ['react-hooks'],
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    '*.config.js',
    '*.config.ts',
    'ios',
    'android',
    '.wrangler',
  ],
};
