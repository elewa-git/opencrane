# @opencrane/state/session/adapter — live browser-session adapter

> [frontend](../../../README.md) › [state](../../README.md) › session › adapter

## What it owns

This package implements the transport-neutral session port from `@opencrane/state/session` with
OpenCrane's generated signed-in HTTP clients. It selects the client from the app surface: the
Control Plane owns organization sessions, while Fleet Manager owns platform-operator sessions.

```
 SessionStore ──SESSION_GATEWAY──► live adapter  ◄── HERE
                                         │ select by PLATFORM_SURFACE
                         ┌───────────────┴────────────────┐
                         ▼                                ▼
               Control Plane /auth               Fleet /auth
```

**In this flow:** [session state](../main/README.md) owns identity signals and capability derivation; each
API remains the authority for its own session.

The adapter never combines identity from the two surfaces. Read failures remain failures so the
store can fail closed, and logout always targets the API that issued the selected session.

## Public surface

- `OpenCraneSessionGateway` — live `SessionGateway` implementation for both application surfaces.

## Boundary

Consumed by app dependency-injection composition. Local development may bind a different
`SessionGateway`; features and `SessionStore` do not need to know which implementation was chosen.

## Dependency direction

Tagged `scope:frontend-session`, `layer:frontend`, and `frontend-role:adapter`. It may import the session
port and shared generated browser clients, but never a feature, app, or backend implementation.

## See also

- Port and store: [session state](../main/README.md)
- Group index: [state](../../README.md)
- Consumer app: [opencrane-ui](../../../../../apps/opencrane-ui/README.md)
