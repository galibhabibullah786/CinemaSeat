import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import base from './eslint.config.js';

/**
 * Browser/React flavour of the shared config. Everything in the base config
 * still applies; this only adds the DOM globals and the two React plugins
 * whose rules catch real bugs rather than style.
 */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // A wrong dependency array is a stale-closure bug that only shows up
      // under a race. Non-negotiable.
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',

      // Keeps hot reload from silently degrading to a full page reload.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
];
