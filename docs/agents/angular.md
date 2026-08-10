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
- If the same presentational or interaction pattern appears in two or more places, extract it into
  the narrowest coherent owner: feature-local while domain-specific, and `elements/ui` only when it
  is genuinely domain-agnostic.
- Routed page components compose the screen, project read-only presentation, delegate typed intents,
  and bridge route/navigation effects. Server reads, command orchestration, authoritative adoption,
  and retry/concurrency state belong to the screen's component-scoped store; display logic belongs
  in feature-local or shared presentational components.
- Check these rules after every implementation cycle.

## Component-manager collaboration gate

Pair frontend implementation with the `component-manager` agent in
`.claude/agents/component-manager.md` whenever adding or materially changing a screen, feature, or
shared visual component.

1. Run `PLAN` before implementation. The component manager inventories the live catalogue and maps
   every screen region to `REUSE`, `EXTEND`, `COMPOSE`, `EXTRACT`, `NEW`, or `KEEP INLINE`.
2. Let the component manager apply shared component APIs, semantic visual states, tokens, and their
   story/fixture, behaviour, accessibility, and screenshot contracts when those changes are needed.
3. Let the frontend implementer own the complete feature slice, with orchestration, data access,
   and domain state placed in the state/store owner, route effects in the routed page, and visual
   assembly in the selected presentational components.
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

## Routed Page Responsibility Gate

Before adding or materially changing a routed page, apply this required ownership map across its
component class, template, styles, state owner, and tests. An exception may refine placement inside the named layer, but it
must never move server authority or command lifecycle into the routed page:

| Responsibility | Default owner |
|---|---|
| Route inputs and authority-derived navigation | Routed page; navigation is an external side effect |
| Server reads, refresh, and retry state | Component-scoped screen store using `resource(...)` or the appropriate resource primitive |
| Mutations, admission, concurrency, idempotency, and conflict recovery | Component-scoped screen store with explicit domain commands |
| Authoritative projection adoption and error translation | Component-scoped screen store |
| Server-model to presentation-model mapping | Pure feature mapper exposed through `computed(...)` |
| Drafts and controlled interaction state | Store or the cohesive interactive component that owns the control |
| Markup, styling, accessibility, and visual-state fixtures | Feature-local or shared presentational components |

A routed page may compose components, expose `computed(...)` presentation, delegate typed intents,
and use an `effect(...)` only to bridge reactive state to route/navigation or another external UI
side effect. Its event handlers end at a typed store command or navigation intent; they do not
contain `await`, command sequencing, `try`/`catch`/`finally`, idempotency handling, conflict recovery,
or authoritative projection writes.

A page-level `computed(...)` may select or combine already-mapped view states. Renaming,
normalisation, defaulting, filtering, sorting, categorical translation, derived labels, and
lifecycle-to-view conversion belong in the pure feature mapper. Draft/control state belongs in the
store when loading, retry, command failure, conflict adoption, route identity, or an authoritative
revision can retain or reset it; presentational components may own only ephemeral visual interaction
state such as focus, open, selected, or expanded state with no server-operation lifetime.

Navigation effects consume authoritative state already adopted by the store and must be idempotent
under repeated reactive emissions. A resource loader, command, mapper, or presentational component
must never navigate to simulate lifecycle advancement.

This gate applies whenever a routed component adds or changes a route input, injected
state/gateway/service, `resource(...)`/`rxResource(...)`/`httpResource(...)`, async command,
writable/model signal, mapper, navigation effect, or interactive visual region. "Materially
changed" is not a line-count threshold.

The PLAN, architecture, component-manager, and independent-review gates must BLOCK a routed page
when any of these conditions is true:

- it injects a gateway/HTTP adapter, declares a server-backed resource, or directly performs server I/O;
- it declares or sequences a server mutation;
- it owns command lifecycle, retry/idempotency coordinates, conflict adoption, or error translation;
- it keeps a writable mirror of an authoritative server projection that is wholly derivable; or
- its template/class/styles contain multiple cohesive interactive regions with independent state,
  behaviour, accessibility, or test contracts.

Do not move all screen responsibilities into a single oversized store. A screen store owns the
screen's authoritative read/command lifecycle; pure mapping stays in a mapper and cohesive visual or
interaction contracts stay in presentational components.

Do not hide mixed ownership behind generic helpers such as `_run`, `_execute`, `withLoading`, or an
async callback wrapper. Moving the wrapper to another file is not a responsibility split when the
page still decides every command step. When one screen needs both a server read and mutations,
require a store boundary before implementation even when the page remains below the mechanical
module-growth threshold.

## Data Access

- Features consume narrow ports from `state/`; they do not call the HTTP client directly.
- State adapters make HTTP calls through the typed client in `core/api`.
- Do not issue HTTP requests from templates or presentational components.

## Angular Signals, Resources, and Forms

- Prefer `resource(...)` for async read/loading flows in the owning component-scoped state owner
  instead of imperative `ngOnInit` data-fetch logic in the routed page.
- Prefer `rxResource(...)` / `httpResource(...)` over ad-hoc Promise orchestration when data originates from observables or HTTP.
- Prefer `computed(...)` for values derived wholly from signals, inputs, or resource state; do not mirror them in writable signals and synchronise them through handlers or an `effect(...)`.
- Use `effect(...)` only to bridge reactive state to an external side effect with an explicit lifecycle. Never use it to copy one signal into another or to start a mutation that can rerun as dependencies change.
- For new or refactored standalone components, prefer `input()` / `output()` over decorator-based `@Input()` / `@Output()` unless Angular requires the decorator form.
- Use signal-driven forms only for new and refactored feature forms.

### Reactive state ownership

- Writable signals remain appropriate for controlled input, transient UI state, retry/idempotency coordinates, explicit optimistic state, and command lifecycle. Do not replace these independent states with `computed(...)`.
- A `resource(...)` loader is a read/projection: it must not write server state, navigate, or otherwise cause an external side effect. Keep mutations as explicit commands and include every reactive identity that selects the read in its request/params.
- Model initial load, refresh while retaining a previous value, initial failure, refresh failure, and retry where applicable. Retained data after a failed refresh is not known-fresh data.
- After a mutation, adopt the authoritative returned projection or reload the resource. Do not maintain a second mutable copy of server state merely to predict the same result.

### Lifecycle state components

When one authoritative lifecycle enum selects materially different screens, use one thin routed shell
with one explicit `@switch` and one feature-local component per state.

- The component-scoped screen store owns the authoritative resource, command admission, and adoption
  of returned projections. The routed shell reads that store, selects exactly one state component,
  delegates typed intents, and owns only route/navigation effects.
- State components receive read-only state input and emit typed domain intents. They never inject the
  gateway, navigate to simulate advancement, or choose their own next durable state.
- Loading, refresh failure, and reconnecting remain resource/command conditions outside the durable
  lifecycle switch unless the server persists them as domain states.
- Each state component composes approved shared primitives. Extract shared presentation used by two
  state components, but never merge distinct lifecycle components merely because their markup overlaps.
- Unknown states fail visibly. Tests enumerate every owned enum member and prove that the shell renders
  exactly one state component for each member.

### Command concurrency

- Choose concurrency at the authority-conflict scope: prevent duplicate admission of the same intent/target, while allowing independent targets where the server contract permits it. A disabled button alone is not an admission guard.
- Guard duplicate command admission before the first `await`; once execution yields, a second event
  can otherwise enter the same server conflict scope.
- Commands that can retry or race across devices carry the server's idempotency, revision, or conflict coordinate. A late completion must not overwrite a newer target, clear another command's busy state, or discard retryable user input.
- Tests cover the applicable initial load, retained-value refresh, failure/retry, duplicate admission,
  and stale/late-completion paths without manufacturing states the screen cannot reach.

## Shared Component Size

- Keep shared component classes focused on presentation and cohesive local interaction state.
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
