# @opencrane/state/session — browser session state

> [frontend](../../../README.md) › [state](../../README.md) › session › main

## What it owns

This package owns browser identity state: **`SessionStore`** holds who is logged in and what they may do, while
`SESSION_GATEWAY` keeps that state independent from HTTP and local-development data. The store
derives coarse **`Capabilities`** flags from the server's central `organization:administer`
decision, and **`PLATFORM_SURFACE`** keeps that product capability separate from platform control.

```
 session/main                          a feature
 ┌─────────────────────┐  reads        ┌──────────────┐
 │ SESSION_GATEWAY     │               │ features/... │
 │       ▼             │◄──────────────│              │
 │ SessionStore        │               └──────────────┘
 └─────────────────────┘
```

**In this flow:** [gateways](../../gateways/README.md)

Invariant: `Capabilities` are **fail-closed** — organisation power requires an explicit central
authorization result, while platform control requires its separate operator claim. A missing value
grants nothing rather than elevating the session. These flags
only hide or disable controls in the UI; the API stays the real enforcement point.

## Public surface

- `SessionStore` — app-wide identity and capability signals.
- `SessionUser` / `SessionProductCapabilities` / `Capabilities` — the identity, central product
  authorization hint, and browser capability read models.
- `SESSION_GATEWAY` / `SessionGateway` — transport-neutral session port supplied by app composition.
- `PlatformSurface`, `PLATFORM_SURFACE` — which strictly-separated surface (platform vs org) this build serves.

## Boundary

Consumed by feature packages for identity and capability gating. It holds identity state but owns
no HTTP implementation, conversation transport, or cache protocol. The sibling
[`session/adapter`](../adapter/README.md) package implements its session port for live APIs.

## Dependency direction

Tagged `scope:frontend-session` and `frontend-role:state`: it depends on Angular and transport-neutral frontend
models — never on apps, backend, server domains, or generated HTTP clients.

## See also

- Parent index: [state](../../README.md)
- Live adapter: [session/adapter](../adapter/README.md)
- Sibling: [gateways](../../gateways/README.md)
