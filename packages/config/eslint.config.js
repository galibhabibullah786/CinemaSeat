import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared ESLint flat config for TypeScript packages (Node-flavoured).
 *
 * Consumers do:
 *   import base from '@baseplate/config/eslint';
 *   export default [...base, { ...local overrides... }];
 *
 * Type-aware rules are ON. They are the only rules that can catch a floating
 * promise or an unsafe `any` crossing a boundary -- the two defects that
 * actually reach production. The cost is that ESLint needs a tsconfig, which
 * is why `projectService` is enabled rather than a hand-maintained file list.
 */
export default tseslint.config(
  {
    // Never lint build output or dependencies. Listed first so it applies
    // globally regardless of what consumers append.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.generated.*',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      /* --- correctness: these are errors, not style --- */

      // An un-awaited promise is a silent failure: the request returns 200 and
      // the write never happened. This rule is the reason type-aware linting
      // earns its runtime cost.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // `any` defeats every other guarantee in this repo. Warn, don't error,
      // so a hackathon can ship -- but it stays visible.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Unused code rots. `_`-prefixed args are the documented escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Structured logging only. A stray console.log in a container is an
      // unparseable line in the log pipeline.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'no-param-reassign': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // Config files and scripts are plain JS/ESM and are not in any tsconfig.
  // Running type-aware rules on them is a hard ESLint CRASH, not a lint
  // finding -- the rule cannot get parser services and throws.
  //
  // Note the explicit `...disableTypeChecked.rules` spread: a flat-config
  // object's `rules` key REPLACES rather than merges, so writing
  // `{ ...disableTypeChecked, rules: { 'no-console': 'off' } }` silently
  // discards every rule the preset just turned off. That mistake looks
  // correct and fails loudly only when you lint a .js file.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },

  // Tests are allowed to be loud and to reach for `any` when building fakes.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/tests/**', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Must be last: turns off every rule Prettier owns so the two never fight.
  prettier,
);
