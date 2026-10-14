// Runs on staged files at commit time. Formatting is applied; lint errors stop the commit.
export default {
  '*.{ts,mts,mjs,cjs,js,html}': ['prettier --write', 'eslint --max-warnings 0 --no-warn-ignored'],
  '*.{json,md,yml,yaml,scss,css}': ['prettier --write --ignore-unknown'],
  'apps/assistant/**/*.py': ['node scripts/py.mjs ruff format', 'node scripts/py.mjs ruff check'],
};
