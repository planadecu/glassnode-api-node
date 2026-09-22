import path from 'node:path';
import eslint from '@eslint/js';
import { includeIgnoreFile } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Flat config does not read .gitignore on its own. Honor it so `eslint .` skips
// everything git ignores — notably `.claude/` (local tooling, including git
// worktrees that are full repo copies) and `coverage/`.
const gitignorePath = path.join(import.meta.dirname, '.gitignore');

export default tseslint.config(
  includeIgnoreFile(gitignorePath, 'Imported .gitignore patterns'),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    languageOptions: {
      globals: {
        fetch: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  }
);
