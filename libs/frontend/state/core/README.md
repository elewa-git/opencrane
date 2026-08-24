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

It owns browser identity state: **`SessionStore`** holds who is logged in and what they may do, while
`SESSION_GATEWAY` keeps that state independent from HTTP and local-development data. The store
derives coarse **`Capabilities`** flags, and **`PLATFORM_SURFACE`** binds those capabilities to the
organisation UI.

```
 core (identity state)                 a feature
 ┌─────────────────────┐  reads        ┌──────────────┐
 │ SESSION_GATEWAY     │               │ features/... │
 │       ▼             │◄──────────────│              │
 │ SessionStore        │               └──────────────┘
 └─────────────────────┘
```

**In this flow:** [gateways](../gateways/README.md)

Invariant: `Capabilities` are **fail-closed** — an operator/admin power requires an explicit `true`
claim from the server; a missing claim grants nothing rather than elevating the session. These flags
only hide or disable controls in the UI; the API stays the real enforcement point.

## Public surface

- `SessionStore` — app-wide identity and capability signals.
- `SessionUser` / `Capabilities` — the identity and capability read models.
- `SESSION_GATEWAY` / `SessionGateway` — transport-neutral session port supplied by app composition.
- `PlatformSurface`, `PLATFORM_SURFACE` — which strictly-separated surface (platform vs org) this build serves.

## Boundary

Consumed by feature packages for identity and capability gating. It holds identity state but owns
no HTTP implementation, conversation transport, or cache protocol. The sibling
[`core/adapter`](./adapter/README.md) package implements its session port for live APIs.

## Dependency direction

Tagged `scope:web` and `frontend-role:state`: it depends on Angular and transport-neutral frontend
models — never on apps, backend, server domains, or generated HTTP clients.

## See also

- Parent index: [state](../README.md)
- Live adapter: [core/adapter](./adapter/README.md)
- Sibling: [gateways](../gateways/README.md)
