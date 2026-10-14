// Proves each guard blocks what it should and lets clean input through.
// Run with: npm run test:guards
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCommand, checkContent, checkPath, checkPrompt } from './index.mjs';

const rulesFor = (path, content, accepted) =>
  checkContent({ path, content, accepted }).map((v) => v.rule);

describe('content rules', () => {
  const blocked = [
    ['apps/api/src/modules/parts/parts.service.ts', 'const x: any = input;', 'no-explicit-any'],
    ['apps/api/src/modules/parts/parts.mapper.ts', 'return doc as any;', 'no-explicit-any'],
    ['apps/web/src/app/x.ts', 'const p = v as unknown as Part;', 'no-double-cast'],
    ['apps/api/src/app.ts', '// @ts-ignore', 'no-ts-ignore'],
    [
      'apps/api/src/app.ts',
      '// eslint-disable-next-line no-console',
      'suppression-needs-exception',
    ],
    [
      'apps/api/src/modules/parts/parts.service.ts',
      'const u = process.env.MONGODB_URI;',
      'env-only-in-config',
    ],
    [
      'apps/api/src/modules/parts/parts.domain.ts',
      "import { Schema } from 'mongoose';",
      'domain-is-framework-free',
    ],
    [
      'apps/api/src/modules/parts/parts.domain.ts',
      "import type { Request } from 'express';",
      'domain-is-framework-free',
    ],
    [
      'apps/api/src/modules/parts/parts.service.ts',
      "import mongoose from 'mongoose';",
      'service-is-http-and-orm-free',
    ],
    [
      'apps/api/src/modules/parts/parts.controller.ts',
      "import { PartModel } from './parts.repository.js';",
      'controller-has-no-persistence',
    ],
    [
      'apps/api/src/modules/parts/parts.controller.ts',
      'await PartModel.create(req.body);',
      'no-mass-assignment',
    ],
    [
      'apps/api/src/modules/parts/parts.repository.ts',
      'return Model.find(req.query);',
      'no-mass-assignment',
    ],
    [
      'apps/api/src/modules/parts/parts.repository.ts',
      "Model.find({ $where: 'this.a > 1' });",
      'no-unsafe-mongo-operators',
    ],
    ['apps/api/src/shared/x.ts', 'const f = eval(source);', 'no-dynamic-code'],
    [
      'apps/api/src/modules/parts/parts.service.spec.ts',
      "it.only('works', () => {});",
      'no-focused-or-skipped-tests',
    ],
    [
      'apps/api/src/modules/parts/parts.service.spec.ts',
      "describe.skip('x', () => {});",
      'no-focused-or-skipped-tests',
    ],
    [
      'apps/web/src/app/x.component.ts',
      'return this.sanitizer.bypassSecurityTrustHtml(v);',
      'no-sanitizer-bypass',
    ],
    ['apps/web/src/app/x.component.ts', 'el.innerHTML = value;', 'no-raw-dom-html'],
    [
      'apps/web/src/app/auth.ts',
      "localStorage.setItem('token', t);",
      'no-credentials-in-web-storage',
    ],
    [
      'apps/assistant/src/assistant/tools.py',
      'from pymongo import MongoClient',
      'assistant-never-touches-mongo',
    ],
    [
      'apps/assistant/src/assistant/llm.py',
      'url = os.environ["OLLAMA_BASE_URL"]',
      'assistant-env-only-in-config',
    ],
    [
      'apps/assistant/src/assistant/llm.py',
      'x = call()  # type: ignore',
      'suppression-needs-exception',
    ],
    [
      'apps/assistant/src/assistant/client.py',
      'httpx.get(url, verify=False)',
      'no-tls-verification-off',
    ],
  ];
  for (const [path, content, rule] of blocked) {
    it(`blocks ${rule} in ${path}`, () => {
      assert.ok(rulesFor(path, content).includes(rule), `expected ${rule} for: ${content}`);
    });
  }

  const allowed = [
    ['apps/api/src/config/env.ts', 'export const config = loadConfig(process.env);'],
    ['apps/api/src/modules/parts/parts.repository.ts', "import { Schema, model } from 'mongoose';"],
    [
      'apps/api/src/modules/parts/parts.controller.ts',
      'const input = createPartSchema.parse(req.body);',
    ],
    [
      'apps/api/src/modules/parts/parts.service.ts',
      'const company: Company = await repo.findById(id);',
    ],
    ['apps/api/src/modules/parts/parts.service.ts', '// never use `as any` here; validate instead'],
    [
      'apps/api/src/modules/parts/parts.service.spec.ts',
      "it('rejects a negative weight', () => {});",
    ],
    ['apps/web/src/app/x.component.ts', "localStorage.setItem('theme', 'dark');"],
    ['apps/assistant/src/assistant/config.py', 'value = os.environ.get("X")'],
    ['scripts/ai/guards/content-rules.mjs', '// @ts-ignore appears here as data'],
  ];
  for (const [path, content] of allowed) {
    it(`allows clean code in ${path}: ${content.slice(0, 40)}`, () => {
      assert.deepEqual(rulesFor(path, content), []);
    });
  }

  it('waives a suppression that cites an accepted exception', () => {
    const line = '// eslint-disable-next-line no-console -- EXC-0007 startup banner';
    assert.deepEqual(rulesFor('apps/api/src/server.ts', line, new Set(['EXC-0007'])), []);
  });

  it('does not waive a suppression citing an exception that was never accepted', () => {
    const line = '// eslint-disable-next-line no-console -- EXC-0099';
    assert.deepEqual(rulesFor('apps/api/src/server.ts', line, new Set(['EXC-0007'])), [
      'suppression-needs-exception',
    ]);
  });

  it('never waives a non-waivable rule', () => {
    const line = '// @ts-ignore EXC-0007';
    assert.ok(
      rulesFor('apps/api/src/server.ts', line, new Set(['EXC-0007'])).includes('no-ts-ignore'),
    );
  });

  it('reports the line number', () => {
    const [violation] = checkContent({
      path: 'apps/api/src/a.ts',
      content: 'ok\nconst x: any = 1;',
    });
    assert.equal(violation?.line, 2);
  });
});

describe('secret rules', () => {
  // Built at runtime so this file never contains something a secret scanner would flag.
  const awsKey = `AKIA${'Q'.repeat(16)}`;
  const mongoUri = ['mongodb+srv://admin', 'hunter2secret@cluster0.example.net/db'].join(':');
  const privateKey = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
  const apiKey = `const apiKey = "${'a1B2'.repeat(8)}";`;

  for (const [name, content] of [
    ['an AWS key', awsKey],
    ['a connection string with a password', mongoUri],
    ['a private key', privateKey],
    ['a hard-coded credential', apiKey],
  ]) {
    it(`blocks ${name} in any file`, () => {
      assert.ok(rulesFor('docs/notes.md', content).some((rule) => rule.startsWith('secret-')));
    });
  }

  it('allows a local connection string without credentials', () => {
    assert.deepEqual(rulesFor('.env.example', 'MONGODB_URI=mongodb://127.0.0.1:27017/print3d'), []);
  });
});

describe('path rules', () => {
  const cases = [
    ['.env', 'deny'],
    ['apps/api/.env.production', 'deny'],
    ['.env.example', 'allow'],
    ['node_modules/express/index.js', 'deny'],
    ['packages/api-contracts/openapi.yaml', 'deny'],
    ['packages/api-contracts/generated/api.d.ts', 'deny'],
    ['.opencode/agents/qa.md', 'deny'],
    ['package-lock.json', 'deny'],
    ['docs/exceptions/EXC-0002-something.md', 'ask'],
    ['docs/standards/mean-engineering-standard.md', 'ask'],
    ['.claude/settings.json', 'ask'],
    ['scripts/ai/guards/content-rules.mjs', 'ask'],
    ['eslint.config.mjs', 'ask'],
    ['apps/api/tsconfig.json', 'ask'],
    ['.github/workflows/ci.yml', 'ask'],
    ['.husky/pre-commit', 'ask'],
    ['apps/assistant/pyproject.toml', 'ask'],
    ['apps/api/src/modules/parts/parts.service.ts', 'allow'],
    ['docs/adr/0005-something.md', 'allow'],
    ['apps/web/src/environments/environment.ts', 'allow'],
  ];
  for (const [path, decision] of cases) {
    it(`${decision}s writing ${path}`, () => {
      assert.equal(checkPath(path).decision, decision);
    });
  }
});

describe('command rules', () => {
  const onFeature = { branch: 'feat/parts', hasCommits: true };
  const onMain = { branch: 'main', hasCommits: true };
  const cases = [
    ['git commit --no-verify -m "x"', onFeature, 'deny'],
    ['git commit -n -m "x"', onFeature, 'deny'],
    ['HUSKY=0 git commit -m "x"', onFeature, 'deny'],
    ['git commit -m "feat: add parts"', onMain, 'deny'],
    ['git merge feat/parts', onMain, 'deny'],
    ['git push origin main', onFeature, 'deny'],
    ['git push origin HEAD:main', onFeature, 'deny'],
    ['git push --force origin feat/parts', onFeature, 'deny'],
    ['git push -f', onFeature, 'deny'],
    ['npm install --legacy-peer-deps', onFeature, 'deny'],
    ['npm install --force', onFeature, 'deny'],
    ['npm install -g @angular/cli', onFeature, 'deny'],
    ['winget install OpenJS.NodeJS', onFeature, 'deny'],
    ['pip install requests', onFeature, 'deny'],
    ['python -m pip install requests', onFeature, 'deny'],
    ['npm audit fix --force', onFeature, 'deny'],
    ['npx tsc --strict false', onFeature, 'deny'],
    ['npx vitest run --passWithNoTests', onFeature, 'deny'],
    ['git reset --hard HEAD~1', onFeature, 'ask'],
    ['docker compose down -v', onFeature, 'ask'],
    ['docker compose exec mongo mongosh --eval "db.dropDatabase()"', onFeature, 'ask'],
    ['rm -rf apps/api/src', onFeature, 'ask'],
    ['Remove-Item -Recurse -Force apps', onFeature, 'ask'],
    ['npm install lodash', onFeature, 'ask'],
    ['npm install --save-dev lodash', onFeature, 'ask'],
    ['npm run py -- uv add requests', onFeature, 'ask'],
    ['echo "{}" > .claude/settings.json', onFeature, 'ask'],
    ['cp .env.example .env', onFeature, 'ask'],
    ['git commit -m "feat(parts): add weight validation"', onFeature, 'allow'],
    ['git commit --amend --no-edit', onFeature, 'allow'],
    ['git commit -m "chore: initial commit"', { branch: 'main', hasCommits: false }, 'allow'],
    ['git push -u origin feat/main-page', onFeature, 'allow'],
    ['git push --force-with-lease origin feat/parts', onFeature, 'allow'],
    ['npm ci', onFeature, 'allow'],
    ['npm install', onFeature, 'allow'],
    ['npm run verify', onFeature, 'allow'],
    ['docker compose up -d', onFeature, 'allow'],
    ['docker compose down', onFeature, 'allow'],
    ['git status', onMain, 'allow'],
    ['git switch -c feat/parts', onMain, 'allow'],
  ];
  for (const [command, ctx, decision] of cases) {
    it(`${decision}s \`${command}\` on ${ctx.branch}`, () => {
      const result = checkCommand({ command, ...ctx });
      assert.equal(result.decision, decision, JSON.stringify(result.violations));
    });
  }
});

describe('prompt rules', () => {
  const deviations = [
    'just make it work, skip the tests',
    'hacelo sin tests por ahora',
    'disable eslint for this file',
    'desactivá el lint que molesta',
    'use any here so it compiles',
    'commit with --no-verify',
    'put the query directly in the controller',
    'sacá la validación del body',
    "let's split this into microservices",
    'hacelo así nomás',
  ];
  for (const prompt of deviations) {
    it(`flags: ${prompt}`, () => {
      assert.ok(checkPrompt(prompt).length > 0);
    });
  }

  const normal = [
    'add a filament inventory module following CU05',
    'agregá el caso de uso CU06 para registrar impresoras',
    'why does the readiness check fail?',
    'run the tests and show me the result',
    'explain what middleware is',
    'now add validation to the filament form',
    'add a note on validation to the README',
  ];
  for (const prompt of normal) {
    it(`does not flag: ${prompt}`, () => {
      assert.deepEqual(checkPrompt(prompt), []);
    });
  }
});
