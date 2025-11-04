import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  globalIgnores(['.clinerules/*', 'dist/*', 'node_modules/*']),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier,
);
