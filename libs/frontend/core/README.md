# @opencrane/core — frontend domain foundation

> [frontend](../README.md) › core

## What it owns

This is the frontend **core** package: the base layer every other frontend package sits on. It
holds the cross-cutting primitives the SPA (the single-page app, `apps/opencrane-ui`) shares — the
domain models, the typed API client, the theme, and pure utilities — so no feature has to redefine
them or hand-roll HTTP.

It is the bottom of the frontend dependency graph: it depends on no other `@opencrane` frontend
package, and everything else may depend on it. Its most load-bearing job is being the **one door to
the server**: all HTTP goes through the API services here, typed against the generated contract, so
a feature never calls `fetch` directly and never guesses a request or response shape.

```
 features · elements · state  ──import──►  core  ──types against──►  @opencrane/contracts
                                            │
                                            └─ ControlPlaneApiService  ──HTTP──►  opencrane-server
```

**In this flow:** `@opencrane/contracts` *(the generated typed client shared with the backend)*

## Public surface

- `lib/models/*.types.ts` — shared data models (DTOs), enums, and colour/label maps (`scope`, `session`, `thread`,
  `context`, `notification`, `settings`, `mcp`, `plan`).
- `CanvasDocument` — the owner-supplied content and action-state contract for context-panel canvas documents.
- `lib/data/*.data.ts` — demo fixtures, temporary until the live API replaces them.
- `ControlPlaneApiService` — the typed HTTP client and its `CONTROL_PLANE_BASE_URL` injection token.
- `OPENCRANE_API_FETCH` — the shared generated/raw client transport seam. Browser builds use native
  fetch; the Tier 1 local profile replaces it with a rejecting transport.
- `OpenCraneApiError` — the browser-safe failed-request model. It preserves the public status/code
  and bounded validation issues so forms can bind `issue.path` to controls, while discarding
  server-only detail and arbitrary response bodies.
- `OpenCranePreset` (`lib/theme/opencrane-preset`) — the PrimeNG (the component library) theme preset
  that maps accessible controls onto OpenCrane's paper, ink, and cyan visual language.
- `lib/theme/opencrane-theme.scss` — shared font loading, canonical `--oc-*` design tokens, reset,
  focus treatment, reduced-motion behaviour, and global typography/overflow primitives used by the
  SPA and Storybook.
- `lib/utils/*` — framework-agnostic helpers (`_ToggleId`, collection helpers).

## Boundary

Consumed by every other frontend package. The control-plane client types against
`@opencrane/contracts`, generated from the backend's OpenAPI spec so the browser and server use the
same contract. It must never import backend application source — the network contract is the only
coupling.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, `scope:shared`, and `frontend-role:core`. It imports no other
frontend package; its one dependency is the shared `@opencrane/contracts` package. Capability-bound
frontend packages may depend on this explicitly cross-cutting core without gaining access to every
legacy `scope:web` package.

## See also

- Parent index: [frontend](../README.md)
- Platform seam: [platform](../platform/README.md)
- Shared visuals: [elements/ui](../elements/ui/README.md)
