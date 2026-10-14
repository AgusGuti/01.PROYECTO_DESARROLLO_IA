// Lint rules for the whole repository. This file is a quality gate: relaxing a rule needs an
// accepted exception record (docs/exceptions). Section numbers refer to
// docs/standards/mean-engineering-standard.md.
import js from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typeChecked = [
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
];

const typeCheckedLanguageOptions = {
  parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
};

/** Rules shared by the API and the web app. */
const sharedTypeScriptRules = {
  curly: ['error', 'multi-line', 'consistent'],
  eqeqeq: ['error', 'always'],
  'no-console': 'error',
  '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  // §5.1: a suppression must explain itself; the guard scan also requires an EXC id.
  '@typescript-eslint/ban-ts-comment': [
    'error',
    { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
  ],
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
};

const forbidImports = (names, message) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: names.map((name) => ({ name, message })),
      patterns: names.map((name) => ({ group: [`${name}/*`], message })),
    },
  ],
});

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.angular/',
    '**/.venv/',
    '.tools/',
    'packages/api-contracts/generated/',
    'playwright-report/',
    'test-results/',
  ]),
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  // Plain Node scripts: guards, hooks, tooling.
  {
    files: ['**/*.mjs', '**/*.cjs', '.opencode/plugins/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // API (Node + Express).
  {
    files: ['apps/api/**/*.ts'],
    extends: typeChecked,
    languageOptions: { ...typeCheckedLanguageOptions, globals: globals.node },
    rules: sharedTypeScriptRules,
  },
  {
    // §6.5: configuration is read once, in config/, and passed around as a typed object.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/config/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read configuration from the typed Config object, not from process.env (§6.5).',
        },
      ],
    },
  },
  {
    // §1.1, §3: the domain knows nothing about HTTP or the database.
    files: ['apps/api/src/**/*.domain.ts'],
    rules: forbidImports(
      ['express', 'mongoose', 'mongodb'],
      'Domain code must not depend on Express or MongoDB (§1.1).',
    ),
  },
  {
    files: ['apps/api/src/**/*.service.ts'],
    rules: forbidImports(
      ['express', 'mongoose', 'mongodb'],
      'Services must not depend on Express or Mongoose; use a repository interface (§6.2).',
    ),
  },
  {
    files: ['apps/api/src/**/*.controller.ts', 'apps/api/src/**/*.routes.ts'],
    rules: forbidImports(
      ['mongoose', 'mongodb'],
      'Controllers translate HTTP only; persistence belongs in a repository (§6.2).',
    ),
  },

  // End-to-end tests and their configuration.
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: typeChecked,
    languageOptions: { ...typeCheckedLanguageOptions, globals: globals.node },
    rules: sharedTypeScriptRules,
  },

  // Web (Angular).
  {
    files: ['apps/web/**/*.ts'],
    extends: [...typeChecked, angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: typeCheckedLanguageOptions,
    rules: {
      ...sharedTypeScriptRules,
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      // Angular components, directives and pipes are classes even when they hold no members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/api/**', '@print3d/api', '@print3d/api/*'],
              message:
                'The web app shares only the public contract: import @print3d/api-contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    // The one place the browser console is the only channel left: bootstrap failure.
    files: ['apps/web/src/main.ts'],
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },

  // Tests may use looser constructs that make assertions readable.
  {
    files: ['**/*.spec.ts', 'apps/api/src/testing/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
