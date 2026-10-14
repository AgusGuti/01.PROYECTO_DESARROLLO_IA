// Conventional Commits: <type>(<optional scope>): <summary>
// Example: feat(api): add filament inventory endpoints
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'body-max-line-length': [1, 'always', 100],
  },
};
