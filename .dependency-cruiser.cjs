// Architecture rules, checked by `npm run arch`. They enforce the layered modular monolith
// described in docs/standards/mean-engineering-standard.md §1. This file is a quality gate.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make modules impossible to understand or test in isolation.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-framework-free',
      severity: 'error',
      comment: '§1.1: domain rules must not depend on Express, Mongoose or MongoDB.',
      from: { path: '\\.domain\\.ts$' },
      to: { path: 'node_modules/(express|mongoose|mongodb)/' },
    },
    {
      name: 'domain-depends-on-nothing-above-it',
      severity: 'error',
      comment: '§6.2: dependencies point inwards: HTTP -> application -> domain.',
      from: { path: '\\.domain\\.ts$' },
      to: { path: '\\.(service|repository|controller|routes|mapper|schemas|openapi)\\.ts$' },
    },
    {
      name: 'service-is-http-and-orm-free',
      severity: 'error',
      comment: '§6.2: services coordinate use cases; they do not know HTTP or the ODM.',
      from: { path: '\\.service\\.ts$' },
      to: { path: 'node_modules/(express|mongoose|mongodb)/|\\.(controller|routes)\\.ts$' },
    },
    {
      name: 'controller-has-no-persistence',
      severity: 'error',
      comment: '§6.2: controllers call services, never repositories or the database.',
      from: { path: '\\.(controller|routes)\\.ts$' },
      to: { path: 'node_modules/(mongoose|mongodb)/|\\.repository\\.ts$' },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment: '§1.2: a module is used only through its index.ts, never its private files.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'modules-only-through-index',
      severity: 'error',
      comment: '§1.2: code outside a module imports that module through its index.ts.',
      from: { pathNot: '^apps/api/src/modules/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/',
        pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'shared-does-not-know-modules',
      severity: 'error',
      comment: '§1.2: shared code is cross-cutting; it must not depend on a feature module.',
      from: { path: '^apps/api/src/(shared|config|infrastructure)/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'production-code-does-not-import-tests',
      severity: 'error',
      from: { pathNot: '(\\.spec\\.ts$|/testing/)' },
      to: { path: '(\\.spec\\.ts$|/testing/)' },
    },
    {
      name: 'web-shares-only-the-contract',
      severity: 'error',
      comment: '§5.1: Angular must not import backend code, only the public contract.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'web-core-does-not-know-features',
      severity: 'error',
      comment: '§9.1: core is shared infrastructure; features depend on it, not the reverse.',
      from: { path: '^apps/web/src/app/core/' },
      to: { path: '^apps/web/src/app/features/' },
    },
    {
      name: 'web-features-are-independent',
      severity: 'error',
      comment: '§9.1: a feature does not reach into another feature.',
      from: { path: '^apps/web/src/app/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/app/features/([^/]+)/',
        pathNot: '^apps/web/src/app/features/$1/',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs'] },
  },
};
