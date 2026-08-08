# Angular / Frontend Guidelines

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.
>
> **Scope note:** these rules apply to the OpenCrane Angular frontend in `apps/opencrane-ui` and
> `libs/frontend/*`. Some packages were originally ported from WeOwnAI, but the live OpenCrane
> packages, public barrels, and dependency graph are the source of truth here.

## Integration Seam

The frontend is **just another client of the opencrane-server** ([API-first](./app-specific.md#api-first-rule)) — never a privileged path:

- It consumes the public `/api/v1` surface through the generated typed client in `@opencrane/contracts` (`___CreateControlPlaneClient` + `paths`). Don't hand-roll request/response shapes that already exist there.
- It authenticates as a human via an OIDC session and gets no capability the API does not grant every client.
- Any new UI feature must be backed by an API endpoint first; the UI wires to that, it does not introduce opencrane-server behaviour of its own.

## PrimeNG Standard

For Angular frontend work, use PrimeNG as the default component library.

- Prefer PrimeNG form, table, navigation, and feedback components over custom implementations.
- Configure theme providers in `app.config.ts` using `providePrimeNG`.
- Keep global visual tokens in `apps/opencrane-ui/src/styles.scss`; avoid ad-hoc per-page colour
  systems.

## Reusable Component Rule (Required)

Always create reusable UI components before writing repeated page-level markup.

- Domain-agnostic shared visual components must live under `libs/frontend/elements/ui`.
- Feature-specific visual components live under their owning `libs/frontend/features/<capability>`
  package; route-level screens compose them with shared elements and services.
- If the same pattern appears in 2 or more places, refactor it into a shared component immediately.
- Page components should focus on orchestration and data flow; display logic belongs in shared components.
- Check these rules after every implementation cycle.

## Component-manager collaboration gate

Pair frontend implementation with the `component-manager` agent in
`.claude/agents/component-manager.md` whenever adding or materially changing a screen, feature, or
shared visual component.

1. Run `PLAN` before implementation. The component manager inventories the live catalogue and maps
   every screen region to `REUSE`, `EXTEND`, `COMPOSE`, `EXTRACT`, `NEW`, or `KEEP INLINE`.
2. Let the component manager apply shared component APIs, semantic visual states, tokens, and their
   story/fixture, behaviour, accessibility, and screenshot contracts when those changes are needed.
3. Let the frontend implementer own feature orchestration, data access, routing, domain state, and
   assembly of the selected components.
4. Run `POST-DIFF` after implementation. It checks for duplicate primitives, arbitrary styling,
   stale state fixtures, and cohesive components hidden inside a growing screen.

A longer screen triggers a responsibility inventory, not an automatic split. Extract a region when
it has a cohesive input/output or interaction/state contract, independent styling and testability,
independent change pressure, or a visual/markup pattern used in two or more places. Keep one-off
static layout inline when extraction would only fragment the screen.

When a different kind of an existing control is required, extend its typed semantic state or
compose it before creating a second base primitive. Do not use Angular class inheritance merely to
reuse templates or styles; prefer a typed variant, content composition, a narrow wrapper, or a host
directive. Class inheritance is reserved for a genuine stable non-visual behavioural contract.

## Frontend Layering

- `core/`: bottom-layer models, typed HTTP client, theme, and pure utilities.
- `elements/`: reusable presentational components; no feature or state dependency.
- `state/`: gateway ports, adapters, dependency-injection wiring, stores, and caches.
- `features/`: routed screens and panes that compose `elements/` and consume `state/` ports.
- `platform/`: browser/desktop runtime-capability seam supplied by the app.
- `apps/opencrane-ui`: thin browser composition and routing root.

## Data Access

- Features consume narrow ports from `state/`; they do not call the HTTP client directly.
- State adapters make HTTP calls through the typed client in `core/api`.
- Do not issue HTTP requests from templates or presentational components.

## Angular Signals, Resources, and Forms

- Prefer `resource(...)` for async read/loading flows in components instead of imperative `ngOnInit` data-fetch logic.
- Prefer `rxResource(...)` / `httpResource(...)` over ad-hoc Promise orchestration when data originates from observables or HTTP.
- Prefer `computed(...)`/`effect(...)` orchestration over manual imperative state transitions when deriving UI state.
- For new or refactored standalone components, prefer `input()` / `output()` over decorator-based `@Input()` / `@Output()` unless Angular requires the decorator form.
- Use signal-driven forms only for new and refactored feature forms.

## Shared Component Size

- Keep shared component classes focused on presentation state and orchestration.
- Move standalone helpers, value parsers, and other pure utilities into sibling `*.utils.ts` files before a shared component grows into multiple concerns.

## Component Template Placement

- Component templates must be defined in separate `*.component.html` files.
- Do not use inline template literals in `@Component` metadata for feature or shared UI components.

## Modern Standalone Angular Imports

- Do not import `CommonModule` or `RouterModule` in standalone components.
- Use modern control flow syntax (`@if`, `@for`, `@switch`) instead of structural directives like `*ngIf` and `*ngFor`.
- Import standalone router directives directly (for example `RouterLink`, `RouterOutlet`) when templates need routing directives.

## Enum-First UI State

- Avoid magic strings in component decision logic.
- Use enums (for example lifecycle phases) and `switch`-based mapping helpers for status-to-UI conversions.

## Delivery Direction (Pre-Production)

- Do not preserve legacy compatibility paths by default while the platform is pre-production.
- Prefer optimal target architecture and delete superseded legacy branches when refactoring.

> The TypeScript coding rules in [`typescript.md`](./typescript.md) (naming, JSDoc, imports, bracket
> placement, etc.) also apply to Angular `.ts` files.
