# @opencrane/state/gateways — gateway dependency-injection root

> [frontend](../../README.md) › [state](../README.md) › gateways

## What it owns

This package is the Angular dependency-injection composition root for the live OpenCrane UI.
Features inject narrow gateway tokens; this package binds the complete production adapter profile.

```
 opencrane-ui
      │ installs providers
      ▼
 provideOpenCraneUiLiveGateways()  ◄── HERE
      │ binds one atomic live profile
      ▼
 live generated-client adapters
      │
      ▼
 frontend features
```

**In this flow:** [mcp/adapter](../mcp/adapter/README.md) ·
[provider-key/adapter](../provider-key/adapter/README.md) ·
[assets/adapter](../assets/adapter/README.md) ·
[skills/adapter](../skills/adapter/README.md)

Production and `development-live` import this profile. Angular file replacement gives default
development a separate local provider entry point, keeping fixtures out of production bundles.

## Public surface

- `provideOpenCraneUiLiveGateways()` — binds the complete live OpenCrane UI profile.

## Boundary

Consumed by `apps/opencrane-ui`. This package owns live wiring only: adapter packages own HTTP
behaviour, the application owns build-time profile selection, and feature packages own presentation
and interaction.

## Dependency direction

Tagged `scope:opencrane-ui`, `layer:frontend`, and `type:lib`: it may compose the UI's state ports
and adapter packages, but never import an app or backend implementation.

## See also

- Parent index: [state](../README.md)
- Siblings: [core](../core/README.md) · [local development](../local-development/README.md) · [assets/adapter](../assets/adapter/README.md) ·
  [skills/adapter](../skills/adapter/README.md)
