import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // `any` is allowed only with an explanatory eslint-disable comment (CLAUDE.md).
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // packages/core must stay UI-free: no React, no DOM.
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'core is UI-free.',
            },
            { group: ['@naqsh/app', '@naqsh/app/*'], message: 'core must not depend on app.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/app/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['*.js', '*.config.{js,ts}', 'packages/*/*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
