---
name: new-web-feature
description: Scaffolds a new Angular feature in apps/web/src/app/features with an API service, pages covering every view state, routing and tests. Use when adding a screen or feature area to the frontend (a list, a detail page, a form, the schedule timeline).
---

# New web feature

Creates `apps/web/src/app/features/<name>/` in the shape of the reference feature
`apps/web/src/app/features/system-status/`. Read it first, and `.claude/rules/web.md`.

**Precondition:** the endpoints exist in `packages/api-contracts/`. If not, build the API first.

## Files

| File                              | Contents                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<name>-api.ts`                   | `@Injectable({ providedIn: 'root' })` service: one method per endpoint, returning `Observable<T>` typed from `@print3d/api-contracts`, with a type guard for the response. |
| `<name>-api.spec.ts`              | `HttpTestingController` tests: URL and method, success, contract mismatch, API error.                                                                                      |
| `<name>-list-page.ts/.html/.scss` | List with states `loading`, `empty`, `loaded`, `failed`.                                                                                                                   |
| `<name>-form-page.ts/.html/.scss` | Reactive form for create and edit, with states `idle`, `saving`, `failed`.                                                                                                 |
| `*.spec.ts` beside each page      | Render tests for every state and the main interactions.                                                                                                                    |

Generate with the CLI so names follow the installed style guide, then fill in:
`npm run ng -w @print3d/web -- generate component features/<name>/<name>-list-page`.

## Patterns to copy

- **View state** as a discriminated union, driven by `toSignal` over a stream with `switchMap`
  for cancellation. See `status-page.ts`.
- **Template** with `@let view = state();` and `@switch (view.kind)`, an `aria-live` region, and
  `role="alert"` for errors. See `status-page.html`.
- **Empty state** tells the user what to do next ("Todavía no cargaste impresoras. Agregá la
  primera.") and offers the action.
- **Forms:** `NonNullableFormBuilder`, validators mirroring the API schema limits, a `<label>`
  for every control, error text linked with `aria-describedby`, submit disabled while saving.
  On `ApiError` with `issues`, set each issue on its control; show `error.message` otherwise.
- **Lists:** `@for (item of items; track item.id)`, pagination controls, no client-side
  filtering of a partial page.
- **Routing:** lazy `loadComponent` entries in `app.routes.ts` with a Spanish `path` and `title`;
  add the link to the navigation in `app.html`.

## Rules that matter most here

- No business rules in components: cost formulas and scheduling live in the API.
- No backend text shown to users; Spanish UI text, English code.
- Nothing is hidden for security reasons; the API decides what is allowed.

## Check

`npm run test:web`, `npm run typecheck:web`, `npm run lint`, then `npm run verify:quick`.
Start the app (`npm run dev`) and use the feature with the keyboard only before calling it done.
