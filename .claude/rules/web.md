---
paths:
  - 'apps/web/**'
---

# Web rules (Angular 22)

Standard §9. `apps/web/src/app/features/system-status/` is the reference feature. Check
`apps/web/package.json` for the installed version and follow its idioms, not older tutorials.

## Structure

- `core/`: app-wide infrastructure (HTTP, configuration). `features/<name>/`: one folder per
  feature, lazy-loaded in `app.routes.ts`. A feature never imports from another feature.
  Create `shared/ui/` only when a second feature needs the same presentational component.
- Standalone components, `ChangeDetectionStrategy.OnPush`, `inject()` for dependencies.
  File names follow the CLI: `status-page.ts`, `status-api.ts`, class `StatusPage`.
- Templates use built-in control flow (`@if`, `@for` with `track`, `@switch`, `@let`).

## State

- Keep state in the feature that owns it. Signals for view state; RxJS where there is a stream,
  cancellation or composition. Do not hold the same value in both.
- Model a view as a discriminated union (`loading | loaded | failed`, plus `empty` for lists)
  and render every case. No independent `isLoading` / `hasError` booleans.
- Subscribe in the template or through `toSignal`; if you must subscribe in code, use
  `takeUntilDestroyed()`. No nested subscriptions: compose with `switchMap` and friends.
- No NgRx or other global store without an ADR.

## Talking to the API

- One `<feature>-api.ts` service per feature. Types come from `@print3d/api-contracts`; never
  redeclare a response type by hand and never import from `apps/api`.
- `HttpClient.get<T>()` does not check the response. Narrow untrusted data with a type guard.
- Errors arrive as `ApiError` from the interceptor, already carrying a safe Spanish message.
  Show `error.message`; never show backend text. Map `error.issues` to form fields.
- Disable the submit control while a request is in flight. Do not auto-retry a `POST`.
- The base URL comes from `API_BASE_URL`. No hard-coded hosts.

## Forms

- Reactive forms for anything beyond a single field. Client validation is for the user's
  convenience; the API validates again and is the authority.

## Security and accessibility

- Guards and hidden buttons are UX, not security. The API enforces every rule.
- No `bypassSecurityTrust*`, no `innerHTML`, no secrets in `environment*.ts`.
- Every control has a label; every page one `h1`; state changes are announced
  (`aria-live`, `role="alert"`); everything works by keyboard with visible focus.

## Language

- UI text in Spanish (Argentina, voseo: "Guardá", "Intentá de nuevo"). Identifiers, comments,
  commit messages and test names in English. Route paths are user-visible, so Spanish.

## Tests

- Test behaviour through the rendered DOM and public API, not private fields. Fake the feature's
  API service; use `HttpTestingController` to test the API service itself.
