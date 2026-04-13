import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const browserGlobals = {
  Blob: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  chrome: 'readonly',
  confirm: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  setTimeout: 'readonly',
};

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: browserGlobals,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
