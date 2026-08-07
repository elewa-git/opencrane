# @opencrane/state/gateways — gateway dependency-injection root

> [frontend](../../README.md) › [state](../README.md) › gateways

## What it owns

This package is the Angular dependency-injection composition root for live frontend data gateways.
Features inject narrow gateway tokens; this package binds those tokens to the adapters that call the
OpenCrane API.

```
 opencrane-ui
      │ installs providers
      ▼
 provideControlPlaneGateways()  ◄── HERE
      │ binds tokens to live adapters
      ▼
 MCP · provider keys · personal assets · skill catalogue
      │
      ▼
 frontend features
```

**In this flow:** [mcp/adapter](../mcp/adapter/README.md) ·
[provider-key/adapter](../provider-key/adapter/README.md) ·
[assets/adapter](../assets/adapter/README.md) ·
[skills/adapter](../skills/adapter/README.md)

All shipped bindings are live. Tests can replace individual tokens with in-memory fakes without
changing feature code.

## Public surface

- `provideControlPlaneGateways()` — returns the live gateway providers for `opencrane-ui`.
- `GatewayMode` / `GATEWAY_MODE` — exposes the active gateway mode to presentation code.

## Boundary

Consumed by `apps/opencrane-ui`. This package owns wiring only: adapter packages own HTTP behaviour,
and feature packages own presentation and interaction.

## Dependency direction

Tagged `scope:web`, `layer:frontend`, and `type:lib`: it may depend only on `scope:web` and
`scope:shared` packages, never on apps or server domains.

## See also

- Parent index: [state](../README.md)
- Siblings: [core](../core/README.md) · [assets/adapter](../assets/adapter/README.md) ·
  [skills/adapter](../skills/adapter/README.md)
