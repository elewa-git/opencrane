# @opencrane/state/core — frontend state-layer hub

> [frontend](../../README.md) › [state](../README.md) › core

## What it owns

This is the hub of the OpenCrane **frontend state layer** — the packages that sit between the
browser UI (the single-page app, or SPA) and the backend HTTP API. The UI never calls HTTP
directly: it calls a **gateway port** instead. A gateway port is just a TypeScript `interface` (plus
an Angular dependency-injection token) that describes *what* data operations exist — `open a thread`,
`list installed tools` — without saying *how* they reach the network. The class that actually makes
the HTTP or WebSocket calls is an **adapter**, and adapters live in the sibling `*/adapter` packages.
This package defines the shared ports and the app-wide identity state everyone else builds on.

It owns one thing: **`SessionStore`**, the signal-based store of who is logged in and what they may do. It reads
the authenticated session through the typed API client and derives coarse **`Capabilities`** flags.
Organisation-management flags come from the server's central `organization:administer` decision;
the **`PLATFORM_SURFACE`** token keeps that product capability separate from platform control.

```
 core (identity state)              a feature
 ┌──────────────────┐  reads        ┌──────────────┐
 │ SessionStore     │◄─────────────│ features/... │
 └──────────────────┘               └──────────────┘
```

**In this flow:** [gateways](../gateways/README.md)

Invariant: `Capabilities` are **fail-closed** — organisation power requires an explicit central
authorization result, while platform control requires its separate operator claim. A missing value
grants nothing rather than elevating the session. These flags
only hide or disable controls in the UI; the API stays the real enforcement point.

## Public surface

- `SessionStore` — app-wide identity and capability signals.
- `SessionUser` / `SessionProductCapabilities` / `Capabilities` — the identity, central product
  authorization hint, and browser capability read models.
- `PlatformSurface`, `PLATFORM_SURFACE` — which strictly-separated surface (platform vs org) this build serves.

## Boundary

Consumed by feature packages for identity and capability gating. It holds identity state and uses
only typed OpenCrane API reads; it owns no conversation transport or cache protocol.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages (here, `@opencrane/core` and Angular) — never on apps, backend, or server domains.

## See also

- Parent index: [state](../README.md)
- Sibling: [gateways](../gateways/README.md)
