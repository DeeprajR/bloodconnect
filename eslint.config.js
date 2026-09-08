import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint is the second reader on every commit in a solo build (build plan,
 * "Standing rules"). The rules that matter here are the ones that catch a
 * clinical mistake rather than a stylistic one: an unhandled union member, a
 * floating promise inside a transaction, an `any` that erases a branded id.
 *
 * The import boundary itself is dependency-cruiser's job (`pnpm boundaries`),
 * not a lint rule — it needs to reason about package entry points, which is a
 * graph question rather than a file one.
 */
/** Everything linted without type information: it belongs to no tsconfig. */
const UNTYPED = [
  'scripts/**/*.mjs',
  // A package's own smoke script: plain Node, in no tsconfig, run by hand
  // against a real database rather than compiled with the package.
  'packages/*/scripts/**/*.mjs',
  '**/*.config.js',
  '**/*.cjs',
  'apps/*/next.config.ts',
  // The service worker runs in its own global scope.
  'apps/*/public/**/*.js',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      'db/migrations/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Named explicitly rather than via `projectService`, because the test
        // files live in their own no-emit project (`tsconfig.test.json`) and the
        // service would otherwise report them as belonging to nothing.
        project: [
          './tsconfig.test.json',
          './packages/*/tsconfig.json',
          './db/tsconfig.json',
          './apps/web/tsconfig.json',
          './apps/admin/tsconfig.json',
          './apps/bot/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A `switch` over a state machine that misses a state is the bug the
      // transition tables exist to prevent (§3).
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // A promise dropped inside a use case is a write that may not have
      // happened when the transaction commits (§7).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      // Branded ids and Result unions only work while the types are honest.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Rules that fight the codebase more than they help it.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Type aliases everywhere: the domain is built from unions and branded
      // primitives, which an interface cannot express, and mixing the two by
      // shape is less readable than picking one.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },

  {
    // Node scripts, linted without type information.
    files: UNTYPED,
    languageOptions: {
      globals: {
        // Node scripts.
        process: 'readonly',
        console: 'readonly',
        module: 'writable',
        fetch: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        // Service worker scope.
        self: 'readonly',
        caches: 'readonly',
        document: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
      },
    },
  },

  {
    // Test files assert on things production code is not allowed to do.
    files: ['**/*.test.ts', 'packages/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Last, deliberately: this clears the type-aware parser options, and a
    // later block supplying its own `languageOptions` would replace the reset
    // rather than merge with it.
    files: UNTYPED,
    ...tseslint.configs.disableTypeChecked,
  },
);
