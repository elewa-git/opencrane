# Persona state adapters

> [frontend](../../README.md) › [state](../README.md) › persona

This group contains browser adapters for the personal-persona lifecycle. The server remains the
authority for interviews, scoring evidence, immutable revisions, and activation; packages here only
translate authenticated generated-client calls into frontend-owned gateway ports.

## Map

| Package | What it owns |
| --- | --- |
| [`adapter`](./adapter/README.md) | Typed transport for the signed-in owner's persona lifecycle. |

```text
 onboarding state port
          │
          ▼
 persona/adapter ──authenticated generated client──► persona API
```

## Dependency rule for this tier

Persona adapters use the bounded `scope:persona-onboarding` capability and
`frontend-role:adapter`. They may depend on the onboarding state port and shared frontend core, but
never on a feature, app, presentational element, or backend implementation.

## See also

- Parent index: [state](../README.md)
- Adapter: [personal persona](./adapter/README.md)
- Routed consumer: [onboarding feature](../../features/onboarding/README.md)
