/* ESLint config for xx-wallet-mobile (React 18 + TypeScript + Vite).
 * Uses the classic .eslintrc format (ESLint 8). */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'public',
    'scripts',
    'sleeve-wasm',
    'coverage',
    '*.config.ts',
    '*.config.js',
    '.eslintrc.cjs',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    // Dev-only Fast Refresh hint. Several screens intentionally co-locate a
    // small helper or constant with their component, so this is off.
    'react-refresh/only-export-components': 'off',
    // Chain/codec interop with polkadot.js relies on dynamic types; `any`
    // is used deliberately in those boundaries.
    '@typescript-eslint/no-explicit-any': 'off',
    // Allow intentionally-unused identifiers when prefixed with `_`.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
};
