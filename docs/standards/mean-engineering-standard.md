---
language: en
scope: Angular + REST API + Node.js/Express + MongoDB
title: Engineering Standard for MEAN Development Agents
updated: 2026-10-13
version: 1.0
---

# Engineering Standard for MEAN Development Agents

## 0. Purpose and instructions for agents

This document defines an engineering standard for building and
maintaining a professional application with a separate Angular frontend,
a REST API, and a Node.js + Express + MongoDB backend. The selected
architecture is a **layered modular monolith**, with one deployable
backend and explicit internal boundaries.

### 0.1 Primary instruction

Before changing code, the agent MUST:

1.  Inspect the existing structure, conventions, versions, scripts, and
    tests.
2.  Identify affected modules and layers, public contracts, persisted
    data, and security risks.
3.  Reuse coherent existing patterns when they comply with this
    standard. Do not introduce a second way to do the same thing without
    justification.
4.  Propose the smallest change that meets the requirement without
    sacrificing security, integrity, maintainability, or observability.
5.  Implement, test, and document the change. Never claim a test passed
    unless it was run and its result verified.
6.  Report assumptions, modified files, tests run, limitations, and
    unresolved decisions.

### 0.2 Normative language

-   **MUST / MUST NOT**: mandatory requirement.
-   **SHOULD / SHOULD NOT**: strong recommendation; deviations require a
    concrete reason.
-   **MAY**: valid option depending on context.
-   Any exception to a mandatory requirement MUST be documented and
    justified. Exceptions involving risk require acceptance by the
    responsible person.

### 0.3 Design principles

-   Correctness and data integrity before premature optimization.
-   Secure by default and least privilege.
-   Explicit contracts between layers and systems.
-   Simple, cohesive, testable, observable code.
-   Validate at trust boundaries; TypeScript types do not validate data
    at runtime.
-   Prefer standard, maintained mechanisms over homegrown solutions.
-   Do not add infrastructure, patterns, abstractions, or dependencies
    without a demonstrable need.
-   The database is the authority for persistence; the backend is the
    authority for business rules and authorization.
-   Important business constraints MUST be testable through automated
    tests.

## 1. Reference architecture

``` text
[ Browser ]
     |
     v
[ Angular: UI / routes / presentation state / HTTP client ]
     |
     | HTTPS + JSON + OpenAPI contract
     v
[ REST API: Express ]
     |
     v
[ Cross-cutting middleware: request ID, authentication, limits, errors ]
     |
     v
[ Controllers / HTTP adapters ]
     |
     v
[ Application services / use cases ]
     |
     +----> [ Domain: entities, rules, policies, errors ]
     |
     v
[ Repositories / persistence adapters ]
     |
     v
[ MongoDB: documents, indexes, validation, transactions when needed ]
```

### 1.1 Boundaries and responsibilities

-   **Angular**: presentation, interaction, navigation, UI state,
    user-experience validation, and API consumption. It is not a
    security boundary or the authority for business rules.
-   **Express / controllers**: translate HTTP to application calls and
    application results to HTTP. Extract parameters, invoke input
    validation, execute a use case, and map its result to an HTTP
    response. Do not put complex business logic here.
-   **Application services / use cases**: coordinate a business
    operation, contextual authorization, repositories, and transactions
    where applicable.
-   **Domain**: rules and invariants independent of HTTP, Angular, and
    MongoDB. It MUST NOT depend on Express, Mongoose, or
    request/response objects.
-   **Repositories**: encapsulate persistence and translate between
    persisted models and domain/application models.
-   **MongoDB**: store data, enforce database-supported constraints, use
    indexes, and perform atomic operations.
-   **Infrastructure**: configuration, logging, metrics, DB connections,
    queues if present, email, and external services.

### 1.2 Modular monolith: default rule

Organize by **business module/feature**, and within each module by
layer. Avoid a global structure that forces developers to traverse huge
`controllers/`, `services/`, and `models/` directories to understand a
single feature.

Example structure, to be adapted to the repository:

``` text
apps/
  web/                         # Angular
  api/                         # Node.js + Express
packages/
  api-contracts/               # Shared types/contracts only if justified
api/src/
  app.ts
  server.ts
  config/
  shared/
    errors/
    http/
    logging/
    security/
  modules/
    users/
      users.routes.ts
      users.controller.ts
      users.schemas.ts
      users.service.ts
      users.repository.ts
      users.domain.ts
      users.mapper.ts
      users.service.spec.ts
      users.repository.int.spec.ts
```

-   `server.ts` initializes the process and listener; `app.ts`
    configures Express so it can be tested without opening a port.
-   Modules MUST NOT import private internals from other modules.
    Communication between modules should use public interfaces,
    application services, or explicit internal events.
-   Do not turn a `shared` module into an indiscriminate dumping ground.
    Put code there only if it is genuinely cross-cutting and stable.
-   Do not introduce microservices, an event bus, CQRS, event sourcing,
    universal generic repositories, or an abstraction for every class
    without a requirement that justifies it.

## 2. Universal principles vs. context-dependent decisions

### 2.1 Universal principles

These apply to almost any professional system:

-   Validate and normalize untrusted data at runtime.
-   Authenticate and authorize on the server.
-   Handle errors without leaking secrets or stack traces to clients.
-   Enforce access control at the resource and property levels.
-   Test critical rules and failure behavior.
-   Version API changes and incompatible migrations.
-   Keep secrets out of source control.
-   Use TLS in transit, structured logs, basic metrics, and alerts.
-   Review dependencies, vulnerabilities, and deployment permissions.
-   Design operations to be idempotent when they may be retried.
-   Limit request size, duration, concurrency, and frequency.

### 2.2 Context-dependent decisions

Choose these based on evidence:

-   **MongoDB transactions**: use only when an invariant requires
    atomicity across multiple documents/collections. Prefer a single
    document and atomic operations when the data model permits it.
-   **Caching**: add when measurements identify a bottleneck and a cache
    invalidation/consistency policy is defined.
-   **Queues**: use for slow work, retries, decoupling, or work outside
    an HTTP request. Queued work requires idempotency and observability.
-   **SSR / Angular server rendering**: decide based on SEO, perceived
    performance, and rendering requirements; it is not mandatory for
    every SPA.
-   **Refresh tokens / sessions**: choose based on the threat model, UX,
    and deployment. Do not copy an authentication recipe without
    deciding where credentials will be stored.
-   **Distributed rate limiting**: required when there are multiple
    replicas and the limit must be global; an in-memory per-process
    limit does not coordinate instances.
-   **Microservices**: consider only when organizational, scaling, or
    isolation needs justify the operational cost.
-   **Abstractions and patterns**: introduce them when they reduce real
    coupling or duplication, not to satisfy a checklist.

## 3. SOLID and maintainable design

SOLID is a design guide, not a law that justifies overengineering.

-   **S --- Single Responsibility**: a module or class should have one
    primary reason to change. Separate HTTP transport, business rules,
    and persistence.
-   **O --- Open/Closed**: extend through interfaces or composition when
    real variation exists; do not create speculative hierarchies.
-   **L --- Liskov Substitution**: implementations of an interface must
    honor its preconditions, postconditions, and expected behavior.
-   **I --- Interface Segregation**: use small interfaces tailored to
    consumers; avoid large interfaces that force irrelevant methods on
    implementers.
-   **D --- Dependency Inversion**: business rules do not depend on
    Express, Mongoose, or concrete providers. Infrastructure implements
    contracts consumed by the application.

Additional practices:

-   Prefer composition over inheritance when simpler.
-   Avoid functions with too many parameters, hidden side effects, and
    mixed responsibilities.
-   Name concepts after the business domain, not accidental
    implementation details.
-   Do not hide important flows in decorators, magic, metaprogramming,
    or hard-to-follow side effects.
-   Avoid `any`; prefer concrete types, `unknown` at untrusted
    boundaries, and explicit narrowing.
-   Never use types as a substitute for runtime validation.
-   Do not return Mongoose documents directly as public API contracts.
-   Do not turn every function into a class merely for consistency.

## 4. ACID, consistency, and MongoDB data modeling

### 4.1 What ACID means

-   **Atomicity**: a transaction completes entirely or its changes are
    not applied.
-   **Consistency**: a transaction preserves the system's defined
    invariants.
-   **Isolation**: concurrent operations do not produce outcomes that
    violate the applicable isolation guarantees.
-   **Durability**: once changes are acknowledged as committed under the
    configured guarantees, they survive the failures covered by those
    guarantees.

ACID is not a code-style checklist or an automatic guarantee for every
distributed operation. MongoDB provides single-document atomicity and
multi-document transactions when needed; schema design and write
configuration matter.

### 4.2 Data modeling rules

-   Model around access patterns and consistency boundaries; do not
    mechanically translate every relational entity into a collection.
-   **Embed** related data that is read together and whose
    lifecycle/size makes embedding appropriate.
-   **Reference** data when it can grow without bound, is widely shared,
    has an independent lifecycle, or needs independent updates.
-   Avoid unbounded arrays and uncontrolled document growth.
-   Define explicit invariants: uniqueness, valid states, relationships,
    limits, deletion rules, and concurrency behavior.
-   Use `ObjectId` or another consistent identifier. Never treat a
    client-supplied identifier as proof of authorization.
-   Define schema, types, defaults, and required fields. Consider
    MongoDB schema validation for important persisted invariants.
-   Avoid persisting derived data that can be recalculated unless
    performance, auditing, or snapshot requirements justify it; define
    how it stays consistent.
-   Define deletion policy: hard delete, soft delete, retention,
    anonymization, and effects on references.

### 4.3 Atomic operations and concurrency

-   Prefer conditional atomic updates, such as updating a document only
    if its `status` still has the expected value.
-   To prevent lost updates, use optimistic concurrency control: a
    version field, `updatedAt`/ETag, or an equivalent condition.
-   Do not assume a read-modify-save sequence is concurrency-safe when
    operations can race.
-   Use unique indexes for true uniqueness. A preliminary "does it
    exist?" query does not prevent concurrent races.
-   Handle duplicate-key errors and transient conflicts correctly.
-   For operations with external side effects, do not assume a database
    transaction can roll back emails, payments, or HTTP calls.

### 4.4 Multi-document transactions

Use them only when a logical operation requires several writes to commit
together.

-   Keep transactions short; do not include external HTTP calls, email
    delivery, or slow work inside them.
-   Use sessions/transactions correctly with the selected driver or ODM.
-   Set `readConcern` and `writeConcern` according to required
    guarantees; do not change levels blindly.
-   Handle aborts, timeouts, conflicts, and transient retries. Retried
    operations must be safe.
-   Do not perform irreversible external side effects inside callbacks
    that the driver may execute again.
-   If consistency between a database write and an external event is
    required, evaluate the **transactional outbox** pattern; do not
    introduce it unless needed.
-   Test against a replica-set/configuration compatible with
    transactions; a standalone test MongoDB may not reproduce production
    behavior.

### 4.5 Indexes and queries

-   Create indexes based on real query patterns and measurements; every
    index consumes space and makes writes more expensive.
-   Index fields used in filters, sorts, applicable `$lookup` joins, and
    uniqueness constraints.
-   Design compound indexes with their prefix, selectivity, and sort
    order in mind.
-   Review query plans with `explain("executionStats")`; investigate
    unexpected collection scans, documents examined, and latency.
-   Paginate lists. For large or changing datasets, prefer cursor/keyset
    pagination over deep `skip`.
-   Enforce maximum values for `limit`, filters, sorting, and
    projections.
-   Never accept arbitrary MongoDB query documents or unrestricted `$`
    operators from users.
-   Use projections to avoid retrieving unneeded fields.
-   Review aggregation, `$lookup`, regex, and unindexed search costs.
-   Do not use TTL indexes as an exact scheduler; expiration is
    eventual.

### 4.6 Validation and migrations

-   Validate API input and reinforce important persisted invariants in
    MongoDB where appropriate.
-   Mongoose validation does not replace unique indexes or
    database-level validation.
-   Treat schema changes as versioned migrations that are repeatable
    where possible, auditable, and accompanied by a
    rollback/compatibility plan.
-   For incompatible changes, use expand → migrate → contract: deploy
    compatibility, migrate data, then remove the old schema.
-   Do not run destructive migrations automatically whenever each
    replica starts.
-   Define backup frequency, retention, and periodic restore tests; an
    unverified backup is not a complete strategy.

## 5. Strict TypeScript

### 5.1 Configuration

-   Enable `strict: true` in frontend and backend.
-   Enable additional options when compatible with the project, such as
    `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
    `noImplicitOverride`.
-   Maintain separate browser and Node configurations if their
    environments differ.
-   Do not disable type rules just to make code compile without
    investigating the underlying issue.
-   Avoid `any`, double casts (`as unknown as X`), and non-null
    assertions (`!`) unless locally justified.
-   Do not automatically share internal domain types or database models
    with Angular; share only stable public contracts.

### 5.2 Trust boundaries

-   Parse and validate with runtime schemas (for example, Zod, Valibot,
    Joi, or another maintained library already selected by the project).
-   Treat `JSON.parse`, HTTP data, environment variables, files, queue
    messages, and third-party responses as `unknown` until validated.
-   Types generated from OpenAPI help prevent drift, but do not replace
    server-side runtime validation.
-   Represent impossible states with discriminated unions when that
    improves clarity.
-   Avoid excessive enums and abstractions; use literal unions when
    simpler.

## 6. Node.js + Express backend

### 6.1 Request pipeline

Recommended flow:

1.  Security middleware, request ID, and global limits.
2.  JSON parser with an explicit size limit.
3.  CORS with explicit allowed origins where applicable.
4.  Authentication.
5.  Router/versioning.
6.  Validation of path parameters, query parameters, and body.
7.  Authorization for function, resource, and properties.
8.  Thin controller.
9.  Application use case/service.
10. Repository and persistence.
11. Mapping to response DTO.
12. Central error middleware.

The actual order may vary for technical reasons, but controls must run
before protected data is accessed or changed.

### 6.2 Controllers, services, and repositories

-   Controllers do not contain business rules or complex MongoDB
    queries.
-   Services/use cases coordinate logic and express the business
    language.
-   Repositories expose domain-relevant operations; avoid generic CRUD
    repositories that hide critical semantics.
-   Mappers transform internal models into explicit DTOs.
-   Never return internal error objects, database documents, hashes,
    tokens, or private fields.
-   Keep dependencies one-way: HTTP → application → domain;
    infrastructure implements required interfaces.

### 6.3 Errors

-   Define typed application errors or stable internal codes for
    validation, unauthenticated, forbidden, not found, conflict,
    rate/limit exceeded, and internal failures.
-   Centralize Express error handling.
-   Use a stable response format, such as `application/problem+json`
    under RFC 9457 if adopted.
-   Never return stack traces, queries, internal paths, secrets, or raw
    driver messages in production.
-   Do not catch errors merely to ignore them. If caught, recover, add
    context, or rethrow.
-   Map errors consistently: `400` for invalid requests, `401` for
    missing/invalid authentication, `403` for insufficient permission,
    `404` when a resource is not found or must be concealed, `409` for
    conflicts, `422` if adopted for semantic validation, `429` for rate
    limiting, and `5xx` for server failures.
-   Avoid revealing whether an account exists when that enables user
    enumeration.

### 6.4 Lifecycle and asynchronous work

-   Use asynchronous APIs and `await` with explicit error handling.
-   Avoid blocking the event loop with CPU-intensive work, huge loops,
    or synchronous operations in request paths.
-   Use worker threads, processes, or queues only when CPU-bound or
    deferred work justifies them.
-   Define timeouts and cancellation for external calls; limit
    concurrency.
-   Configure graceful shutdown: stop accepting traffic, finish or
    cancel work within a deadline, close DB connections, and release
    resources.
-   Uncaught exceptions must not be normal control flow. Log context and
    terminate safely if the process may be in an unknown state.
-   Use a supported Node.js LTS release and maintain an upgrade process.

### 6.5 Configuration

-   Validate environment variables at startup; fail fast when required
    configuration is missing.
-   Do not put secrets in code, container images, logs, or source
    control.
-   Separate environment configuration without duplicating business
    logic.
-   Do not use insecure defaults in production.
-   Keep configuration typed and centralized instead of reading
    `process.env` throughout the codebase.

## 7. REST API design

### 7.1 Contract

-   Define a versioned OpenAPI contract as the reviewable source for
    routes, parameters, schemas, authentication, responses, and errors.
-   Use JSON and consistent naming.
-   Model resources with nouns and use HTTP methods according to their
    semantics.
-   Do not expose MongoDB collections or document structure directly.
-   Define date/time formats (ISO 8601/RFC 3339), time zone, and
    precision.
-   Document limits, sorting, filtering, pagination, permissions, and
    error codes.
-   Generate or validate clients/types from the contract if this reduces
    drift; do not turn generation into a black box.

### 7.2 HTTP semantics

-   `GET`: read-only with no business side effects; it should be safe.
-   `POST`: creation or a non-idempotent action unless the contract
    explicitly says otherwise.
-   `PUT`: full replacement/idempotent update according to the contract.
-   `PATCH`: partial modification; define the format and semantics.
-   `DELETE`: deletion; document repeated-request behavior.
-   Use correct status codes; do not return `200` for every outcome.
-   Add `ETag`/`If-Match` or version control when concurrent edits
    require it.
-   For retryable creation operations, consider an idempotency key with
    persistence and an expiration policy.
-   Do not implement idempotency only in in-memory cache if multiple
    instances exist.

### 7.3 Versioning and compatibility

-   Version breaking changes (for example, `/api/v1`) and communicate
    deprecations.
-   Additive changes are not always harmless: new required fields, new
    enum values, or format changes can break consumers.
-   Maintain backward compatibility when reasonable; define retirement
    criteria and dates.
-   Include contract tests for responses, errors, and authentication.
-   Do not keep versions indefinitely without an inventory and
    retirement plan.

### 7.4 Pagination, filtering, and limits

-   Set default and maximum pagination sizes.
-   Validate and normalize filters; allowlist sortable fields and sort
    direction (`asc`/`desc`).
-   Do not interpolate arbitrary user fields into queries or pass client
    query objects through unchanged.
-   Apply request-body size, processing-time, request-rate, and
    query-cost limits.
-   For bulk operations, define limits, partial-result behavior, and
    asynchronous processing if appropriate.
-   Document empty-result behavior and totals when computing totals is
    expensive.

## 8. Security: minimum requirements

### 8.1 Authentication and authorization

-   Authentication identifies a subject; authorization determines what
    that subject may do to each resource and property.
-   Enforce authorization on the server for every protected operation,
    not only through Angular guards.
-   Verify function-, object-, and property-level permissions to prevent
    BOLA/IDOR and mass assignment.
-   Apply least privilege to users, services, databases, and pipelines.
-   Define expiration, revocation, rotation, and secure storage for
    credentials/tokens.
-   Never store plaintext passwords or use generic fast hashes; use a
    recognized password-hashing algorithm configured appropriately.
-   Never invent a cryptographic system.
-   Avoid storing long-lived tokens in `localStorage` when the threat
    model makes them vulnerable to XSS. If cookies are used, define
    `HttpOnly`, `Secure`, `SameSite`, domain/path, and CSRF protection
    according to the authentication flow.
-   CORS is not authentication or authorization.
-   Angular guards improve UX but are not security controls.

### 8.2 Validation, injection, and data exposure

-   Validate each input's shape, type, length, range, format, enum
    values, and limits.
-   Use allowlists for fields and operations; do not accept `$where`,
    arbitrary operators, or free-form MongoDB filters directly from
    clients.
-   Prevent NoSQL injection by building queries from validated fields
    and typed values.
-   Use explicit input and output DTOs; never mass-assign `req.body` to
    a database document.
-   Treat third-party data as untrusted too.
-   Sanitize output for its context. Avoid unsafe DOM manipulation and
    Angular sanitization bypasses.
-   Avoid `eval`, `new Function`, untrusted dynamic templates, and
    disabling security protections without expert review.
-   Do not expose stack traces, internal fields, infrastructure
    identifiers, or unnecessary personal data.

### 8.3 Transport and browser controls

-   Use HTTPS/TLS in production and between components when required by
    the network and threat model.
-   Configure Helmet and appropriate headers; review CSP for the actual
    application.
-   Configure CORS with an explicit list of origins, methods, and
    headers. Do not reflect arbitrary `Origin` values with credentials.
-   Use secure cookie settings when cookies are used.
-   Apply CSRF protection when credentials are automatically sent by the
    browser (for example, cookies), according to the flow.
-   Apply request-size limits, upload limits, timeouts, and rate limits.
-   Disable `X-Powered-By` and avoid unnecessary banners/version
    disclosure.
-   Validate outbound URLs and destinations when the backend fetches
    resources to prevent SSRF.

### 8.4 Abuse, availability, and dependencies

-   Protect login, password recovery, OTP, and sensitive flows against
    brute force and automation.
-   Apply rate limits by IP and/or identity as appropriate; use shared
    storage for multi-instance deployments when limits must be global.
-   Define resource quotas and concurrency limits.
-   Keep dependencies updated, review security advisories, and audit
    dependencies.
-   Pin versions through a lockfile and use reproducible installs in CI.
-   Review install scripts, new dependencies, licenses, and abandoned
    packages.
-   Never log passwords, tokens, cookies, keys, payment data, or
    sensitive request bodies.
-   Establish log retention and access policies.
-   Use least-privilege CI secrets and do not expose them to untrusted
    pull-request code.

### 8.5 Threat modeling

For features involving sensitive data, payments, roles, files,
integrations, or administration:

1.  Identify assets, actors, trust boundaries, and data flows.
2.  List plausible threats: unauthorized access, property tampering,
    resource abuse, SSRF, secret leakage, replay, and privilege
    escalation.
3.  Select controls and tests.
4.  Document residual risks and the person responsible for accepting
    them.

Use the OWASP API Security Top 10 as a risk checklist, not as a
substitute for feature-specific analysis.

## 9. Angular frontend

### 9.1 Organization and components

-   Prefer standalone components in modern Angular versions, following
    the style guide for the installed version.
-   Organize by feature and separate reusable UI from page-specific
    components.
-   Keep components focused on presentation and UI coordination; move
    complex business logic to pure/application services where
    appropriate.
-   Avoid complex template logic and oversized components.
-   Use lazy loading for routes/features when it reduces the initial
    bundle.
-   Use reactive forms for complex forms, dynamic validation, or longer
    workflows; choose the form approach that keeps the solution simple.
-   Do not create a global service for every trivial function or a
    shared library prematurely.

### 9.2 State and reactivity

-   Keep state as close as possible to the feature that needs it.
-   Use Signals/RxJS according to the kind of state and conventions of
    the installed Angular version; do not duplicate the same state
    across mechanisms.
-   Use RxJS for asynchronous streams, event composition, and
    cancellation; avoid nested subscriptions.
-   Prefer `async` pipe or appropriate interoperability APIs to manage
    subscriptions.
-   Avoid subscriptions that are never cleaned up; use teardown
    mechanisms available in the installed Angular version.
-   Do not introduce NgRx or another global state library unless state
    complexity justifies it.
-   Distinguish server state, form state, navigation state, and
    ephemeral UI state.

### 9.3 HTTP and errors

-   Centralize HTTP configuration, interceptors, and common error
    translation without hiding operation-specific logic.
-   Type requests and responses against the contract; remember HTTP
    generics do not validate JSON at runtime.
-   Handle loading/success/empty/error states and prevent duplicate
    submissions.
-   Cancel obsolete requests where appropriate.
-   Do not automatically retry non-idempotent operations without an
    idempotency mechanism.
-   Do not expose internal backend messages to users; map them to
    useful, safe messages.
-   Configure the API base URL by environment; do not hardcode
    production domains.

### 9.4 Security and accessibility

-   Never rely on the client for authorization or hide sensitive data
    assuming users cannot discover it.
-   Avoid `bypassSecurityTrust...` except in exceptional, reviewed cases
    with validated sources.
-   Do not insert untrusted HTML.
-   Apply a CSP compatible with the application and avoid unsafe inline
    scripts where possible.
-   Do not put secrets in frontend bundles, frontend environment files,
    or public source maps.
-   Use semantic controls, keyboard navigation, labels, visible focus,
    and accessible messages.
-   UX validation complements server validation; it never replaces it.

### 9.5 Performance

-   Measure before optimizing.
-   Review bundle size, lazy loading, images, repeated rendering, and
    redundant HTTP calls.
-   Use Angular and browser performance tools.
-   Use stable tracking in lists and rendering strategies appropriate to
    the installed version.
-   Avoid expensive computations repeated in templates.
-   Consider SSR/hydration only when justified by the use case.
-   Define measurable performance goals (for example, relevant Core Web
    Vitals) when the product requires them.

## 10. Testing and quality

### 10.1 Balanced test pyramid

-   **Unit tests**: pure functions, domain rules, and use cases with
    isolated dependencies.
-   **Integration tests**: repositories, MongoDB queries, middleware,
    and realistic configuration.
-   **API/contract tests**: routes, validation, authentication,
    authorization, response schemas, and HTTP codes.
-   **End-to-end tests**: critical user flows across the full system.
-   **Security tests**: object/property access controls, abuse limits,
    injection, and authorization regressions.
-   Do not measure quality only by coverage percentage. Coverage helps
    find gaps; it does not prove assertions are meaningful.

### 10.2 Scenarios to test

For every important use case, cover at least:

-   Successful path.
-   Invalid input and boundaries.
-   Missing authentication.
-   Authenticated user without permission.
-   Missing resource or resource outside the user's scope.
-   Concurrency/uniqueness conflicts where applicable.
-   Persistence and external dependency failures.
-   Retries, idempotency, and side effects where applicable.
-   Pagination and sorting limits.
-   Absence of sensitive-field leakage.

### 10.3 Test quality

-   Tests MUST be deterministic, isolated, and repeatable.
-   Do not depend on internet access, real wall-clock time, execution
    order, or unstable shared data; inject clocks/randomness when
    relevant.
-   Use explicit fixtures and the minimum data necessary.
-   Avoid trivial assertions, unreadable giant snapshots, and mocks that
    merely reproduce implementation details.
-   Mock external boundaries in unit tests; use ephemeral real services
    or test environments for critical integration tests.
-   Clean up test data and avoid shared state between tests.
-   Use a MongoDB setup compatible with production operations; for
    transactions, reproduce the required topology.
-   Every fixed bug SHOULD have a regression test when reasonable.
-   Do not disable failing tests just to get a green pipeline without
    resolving and documenting the cause.

### 10.4 Quality gates

Before merging changes, run available equivalents of:

1.  Formatting and lint.
2.  Type checking.
3.  Unit tests.
4.  Relevant integration/API tests.
5.  Production build.
6.  Dependency and secret scanning.
7.  E2E tests for critical flows when affected.

Never claim success without reviewing the final process result. If a
test could not be run, report that clearly.

## 11. Observability and operations

### 11.1 Logs

-   Use structured logs (JSON in production when suitable for the
    platform).
-   Include timestamp, level, service/environment, request ID or trace
    ID, and error code.
-   Record relevant events: startup/shutdown, errors, dependency
    failures, failed jobs, and security decisions without sensitive
    data.
-   Propagate a correlation identifier across layers and external
    services where appropriate.
-   Never log secrets, credentials, unnecessary personal data, or entire
    documents.
-   Avoid logging the same error at every layer; log it at the
    responsible boundary with sufficient context.

### 11.2 Metrics and traces

At minimum, observe:

-   Request and error rates by route/status.
-   p50/p95/p99 latency.
-   CPU, memory, event-loop saturation, and connections.
-   MongoDB latency, errors, and connection pool.
-   External provider timeouts, retries, and errors.
-   Queue/worker metrics if present.
-   Health checks and the status of the last deployment.

Use OpenTelemetry or platform-supported instrumentation when distributed
tracing answers useful operational questions. Do not add a complex
observability stack without defining the questions it must answer.

### 11.3 Health checks and resilience

-   Separate **liveness** (the process is alive) from **readiness** (it
    can accept traffic).
-   Do not make a transient dependency failure trigger infinite restarts
    if temporarily removing traffic is more appropriate.
-   Configure timeouts, concurrency limits, and bounded retries.
-   Use exponential backoff with jitter for safe retries.
-   Avoid retry cascades and request storms.
-   Implement degraded behavior only when the business accepts
    incomplete data or partial functionality.
-   Document RTO/RPO when continuity requirements justify them.

### 11.4 Backups and recovery

-   Define backup frequency, retention, encryption, permissions, and
    independent storage location.
-   Test restores in an isolated environment regularly.
-   Document steps, owners, dependencies, and verification criteria.
-   Consider PITR/replication according to RPO/RTO and provider
    capabilities.
-   Replication does not replace backups; deletions and corruption can
    replicate too.

## 12. CI/CD and change management

### 12.1 Pull requests

Each change SHOULD include, as applicable:

-   Problem and solution description.
-   Risks, decisions, and trade-offs.
-   API, schema, environment-variable, and migration changes.
-   Tests added and executed.
-   Security and observability considerations.
-   Deployment/rollback plan for risky changes.

### 12.2 Minimum pipeline

1.  Secure checkout and reproducible dependency installation from the
    lockfile.
2.  Formatting/lint.
3.  Strict type checking.
4.  Unit tests.
5.  Relevant integration/API tests.
6.  Build.
7.  Dependency audit and secret detection.
8.  Build an immutable artifact.
9.  Deploy to a test environment and run smoke tests.
10. Approval and progressive production deployment according to risk.
11. Post-deployment verification and a defined rollback path.

### 12.3 Pipeline security

-   Apply least privilege to tokens, `GITHUB_TOKEN`, and equivalent
    credentials.
-   Pin third-party actions to immutable versions/commit SHAs where
    recommended by the platform.
-   Do not run untrusted pull-request code with deployment secrets.
-   Separate CI and CD permissions.
-   Prefer OIDC/identity federation over static secrets when supported
    by the platform.
-   Never print secrets or artifacts containing them.
-   Protect branches, reviews, and production environments.
-   Maintain traceability between commit, artifact, and deployment.

### 12.4 Migrations and deployments

-   Keep deployments repeatable and idempotent.
-   Do not rely on undocumented manual production changes.
-   Run migrations as a controlled step, not concurrently at every
    instance startup.
-   Prefer changes compatible with both old and new application versions
    during rolling deployments.
-   Define application rollback and data strategy; reverting a binary
    does not automatically undo a migration.
-   Use feature flags only when gradual activation or functional
    rollback is needed; assign an owner and cleanup plan.
-   Record the deployed version and commit/artifact.

## 13. Performance and scalability with discipline

-   Measure first; establish a baseline and target.
-   Optimize queries and indexes before adding caches or rewriting
    components.
-   Define budgets for latency, memory, bundle size, and critical
    queries.
-   Limit payloads, lists, concurrency, and expensive work.
-   Avoid N+1 data access and external calls.
-   Do not run long CPU-bound work on the event loop.
-   Scale horizontally only after reviewing in-memory state, sessions,
    rate limits, scheduled jobs, and DB connections.
-   With multiple replicas, do not rely on local memory for locks,
    idempotency, shared sessions, or global limits.
-   Caching requires TTLs, invalidation, memory bounds, and a stale-data
    policy; caching sensitive or authorization-dependent data requires
    special care.
-   Use representative load tests for critical routes before major
    capacity changes.

## 14. Data, privacy, and audit

-   Classify data by sensitivity and minimize collection.
-   Apply retention and deletion policies based on legal obligations and
    business needs.
-   Encrypt data in transit and use platform encryption-at-rest
    capabilities.
-   Restrict production access and audit privileged operations.
-   Keep production data out of development environments; anonymize or
    synthesize test data.
-   Define audit records for sensitive changes: actor, action, resource,
    timestamp, and result, without secrets.
-   Synchronize clocks and store instants in UTC; present time zones in
    the UI as needed.
-   Do not assume legal compliance merely by using a tool; requirements
    depend on jurisdiction and the data processed.

## 15. Agent role contracts

### 15.1 Architect agent

**MUST** - Maintain module boundaries and dependency direction. - Record
significant decisions and alternatives. - Prefer a modular monolith
unless there is evidence for distribution. - Define API contracts,
invariants, data models, and operational requirements.

**MUST NOT** - Introduce microservices, CQRS, event sourcing, or new
platforms without a business case. - Allow the domain to depend on
Express or Mongoose. - Prescribe patterns without explaining the problem
they solve.

**Deliverables** - Diagram/flow, affected modules, decisions, risks, and
acceptance criteria.

### 15.2 Angular frontend agent

**MUST** - Follow the style guide for the installed version and maintain
strict TypeScript. - Consume documented contracts, represent
loading/error/empty/success states, and ensure accessibility. - Keep
critical business rules and secrets out of the client. - Test critical
components/services.

**MUST NOT** - Treat guards or form validation as server security. -
Disable sanitization or use bypasses without justification and review. -
Duplicate state unnecessarily or add global libraries prematurely.

**Deliverables** - Components/services, tests, UI states, and
typecheck/build evidence.

### 15.3 Backend/API agent

**MUST** - Keep controllers thin, use cases clear, and errors
consistent. - Validate inputs at runtime and enforce
resource/property-level authorization. - Document OpenAPI contracts and
limits. - Apply appropriate timeouts, logging, and error handling.

**MUST NOT** - Accept free-form query documents or persistence models
from clients. - Leak internal errors or sensitive data. - Automatically
retry non-idempotent operations.

**Deliverables** - Routes, DTOs/schemas, use cases, API tests, and
updated documentation.

### 15.4 Data/MongoDB agent

**MUST** - Document embedding/referencing choices and invariants. -
Justify indexes based on query patterns and, where possible,
`explain`. - Use atomic operations and transactions when consistency
requirements demand them. - Create safe migrations and test
restore/compatibility when applicable.

**MUST NOT** - Assume a preliminary check guarantees uniqueness. - Use
transactions by default for every operation. - Run destructive
migrations without a strategy and approval.

**Deliverables** - Schema/model, indexes, migration, rollback plan, and
persistence tests.

### 15.5 QA agent

**MUST** - Translate requirements and invariants into verifiable
scenarios. - Cover success, failure, permissions, limits, concurrency,
and relevant regressions. - Keep tests deterministic and report
flakiness.

**MUST NOT** - Approve based on coverage alone. - Mock all persistence
and claim DB integration was tested. - Skip authorization tests because
the UI hides an action.

**Deliverables** - Requirement-to-test matrix, results, gaps, and
residual risks.

### 15.6 DevOps/SRE agent

**MUST** - Maintain reproducible pipelines, traceable artifacts,
protected secrets, and reversible deployments. - Define health checks,
alerts, logs, metrics, backups, and restore tests. - Apply least
privilege to infrastructure and pipelines. - Document incident response
and recovery proportional to risk.

**MUST NOT** - Store secrets in source control or container images. -
Treat replicas as backups. - Deploy incompatible migrations without
coordination.

**Deliverables** - Pipeline/configuration, relevant dashboards/alerts,
runbook, and rollback strategy.

### 15.7 Code review agent

Review in this order:

1.  Correctness and business rules.
2.  Authorization, validation, and data exposure.
3.  Integrity/concurrency and migrations.
4.  Error handling and resilience.
5.  Relevant tests.
6.  Maintainability, complexity, and measured performance.
7.  Documentation/contracts.

The reviewer MUST NOT block changes for unagreed stylistic preferences,
approve merely because code compiles when security/integrity risks
remain, or bundle broad unrelated refactors into a small functional
change.

## 16. Change acceptance checklist

A change is ready when all relevant items are verified:

### Design

-   [ ] The requirement and acceptance criteria are clear.
-   [ ] Layer and module boundaries are respected.
-   [ ] No unnecessary complexity was introduced.
-   [ ] Context-dependent decisions are justified.

### Security

-   [ ] Inputs are validated at runtime.
-   [ ] Authentication and authorization are checked on the server.
-   [ ] Object/property permissions were reviewed.
-   [ ] No mass assignment or unsafe query construction exists.
-   [ ] Errors/logs do not expose secrets or sensitive data.
-   [ ] Resource limits are appropriate.

### Data

-   [ ] Business invariants are defined and enforced.
-   [ ] Concurrency, atomicity, and idempotency were reviewed.
-   [ ] Indexes and queries are appropriate.
-   [ ] Migrations are compatible, controlled, and recoverable where
    applicable.
-   [ ] Retry behavior and partial failures were considered.

### Quality

-   [ ] Typecheck, lint, and build pass.
-   [ ] Relevant positive and negative tests were added.
-   [ ] Relevant tests were run and actual results reported.
-   [ ] Tests are deterministic and cover critical regressions.
-   [ ] OpenAPI/documentation is up to date.

### Operations

-   [ ] Logs/diagnostics are sufficient and contain no sensitive data.
-   [ ] Timeouts and dependency handling are reasonable.
-   [ ] Operational configuration/secrets/docs were updated as needed.
-   [ ] A deployment/rollback strategy exists for risky changes.

## 17. Anti-patterns to avoid

-   Business logic in controllers or UI components.
-   A single `utils.ts`/`shared` area that accumulates everything.
-   TypeScript types used as the only validation for external JSON.
-   Propagating `any` to avoid fixing type errors.
-   Returning Mongoose documents directly to clients.
-   MongoDB queries built from unrestricted user filters.
-   Preliminary uniqueness checks without a unique index.
-   Long transactions containing external calls.
-   Retrying non-idempotent operations.
-   Authorization implemented only in Angular.
-   Secrets, passwords, or personal data in logs.
-   Catching exceptions and continuing as if nothing happened.
-   Caching without invalidation or bounds.
-   Assuming in-memory rate limiting is global in a multi-instance
    system.
-   Test suites that mock every boundary and never test integration.
-   Using coverage percentage as the sole quality metric.
-   Running migrations at every replica startup.
-   Incompatible API/DB changes without a deployment plan.
-   New dependencies, services, or patterns without a demonstrable need.
-   Large "cleanup" refactors mixed with small functional changes.

## 18. Recommended agent workflow

1.  **Understand**: inspect code, contracts, tests, versions, and
    conventions.
2.  **Plan**: list affected files/layers, invariants, risks, and tests.
3.  **Design**: choose the simplest solution that preserves boundaries
    and contracts.
4.  **Implement**: make focused changes with strict types and runtime
    validation.
5.  **Test**: run targeted tests, then all applicable quality gates.
6.  **Review**: check security, concurrency, side effects, and
    compatibility.
7.  **Document**: update OpenAPI, decisions, migrations, and runbooks
    when applicable.
8.  **Report**: summarize changes, verification, results, and
    outstanding risks.

If an essential requirement is missing, the agent MUST ask a focused
question or state an explicit assumption before making a hard-to-reverse
decision. It MUST NOT invent business requirements.

## 19. Official sources and reference material

Consult current versions when implementing. Framework-specific
recommendations must match the versions pinned in the repository.

### Angular and TypeScript

-   Angular --- Style Guide: https://angular.dev/style-guide
-   Angular --- Security: https://angular.dev/best-practices/security
-   Angular --- Performance:
    https://angular.dev/best-practices/performance
-   Angular --- Testing: https://angular.dev/guide/testing
-   TypeScript --- TSConfig `strict`:
    https://www.typescriptlang.org/tsconfig/strict.html
-   TypeScript --- Handbook:
    https://www.typescriptlang.org/docs/handbook/intro.html

### Node.js and Express

-   Node.js --- Security best practices:
    https://nodejs.org/en/learn/getting-started/security-best-practices
-   Node.js --- Diagnostics: https://nodejs.org/en/learn/diagnostics
-   Express --- Security best practices:
    https://expressjs.com/en/advanced/best-practice-security/
-   Express --- Performance and reliability:
    https://expressjs.com/en/advanced/best-practice-performance/
-   Express --- Error handling:
    https://expressjs.com/en/guide/error-handling.html

### MongoDB

-   MongoDB --- Atomicity and transactions:
    https://www.mongodb.com/docs/manual/core/transactions/
-   MongoDB --- Write operations atomicity:
    https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
-   MongoDB --- Indexes: https://www.mongodb.com/docs/manual/indexes/
-   MongoDB --- Schema validation:
    https://www.mongodb.com/docs/manual/core/schema-validation/
-   MongoDB --- Explain results:
    https://www.mongodb.com/docs/manual/reference/explain-results/
-   MongoDB --- Security checklist:
    https://www.mongodb.com/docs/manual/administration/security-checklist/

### Security and API contracts

-   OWASP API Security Top 10 (2023):
    https://owasp.org/www-project-api-security/
-   OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
-   OpenAPI Specification: https://spec.openapis.org/oas/latest.html
-   RFC 9110 --- HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
-   RFC 9457 --- Problem Details for HTTP APIs:
    https://www.rfc-editor.org/rfc/rfc9457

### Delivery and supply chain

-   GitHub Actions --- Secure use:
    https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
-   npm --- Auditing package dependencies:
    https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities
-   OpenTelemetry --- Documentation: https://opentelemetry.io/docs/

## 20. Final decision rule

When practices conflict, the agent MUST prioritize in this order:

1.  Security, privacy, and applicable compliance.
2.  Correctness, invariants, and data integrity.
3.  Public contracts and compatibility.
4.  Availability and failure recovery.
5.  Maintainability and clarity.
6.  Performance demonstrated by measurement.
7.  Stylistic preferences.

Every exception must be explicit. The goal is not to maximize the number
of patterns, tools, or layers; it is to deliver a correct, secure,
observable, verifiable, reasonably simple system.
