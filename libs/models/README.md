# Models — pure types and decision rules

> [OpenCrane](../../README.md) › models

This is the platform's shared vocabulary. Every package here is a **model**: plain TypeScript
types plus pure decision functions — no database, no network, no side effects. Because they touch
nothing, both the backend and the frontend can import them freely, and a rule written here is
enforced identically on both sides.

## Map

| Package | What it owns |
| --- | --- |
| [`agents`](./agents/main/README.md) | Agent-domain types and lifecycle rules. |
| [`artifacts`](./artifacts/main/README.md) | Content-addressed artifact types and invariants. |
| [`authorization`](./authorization/main/README.md) | Capabilities, proofs, and the pure allow/deny function. |
| [`conversations`](./conversations/main/README.md) | Conversation modes, lifecycle, messages, timeline coordinates, and pure command decisions. |

```
                 libs/models  (pure — no I/O)
    ┌───────────┬────────────┬───────────────┐
  agents    artifacts   authorization   conversations
    └───────────┴────────────┴───────────────┘
                        │ imported by
              ┌─────────┴─────────┐
          backend               frontend
```

## Dependency rule for this tier

A model package carries `layer:model` and may import **only** shared contracts (`scope:shared`)
and same-scope peers — never a backend domain, a frontend package, an infrastructure library, or
an app. That is what keeps it pure and safe to depend on from anywhere. Consumers reach a model
through its public barrel (`@opencrane/models/<name>`), never an internal source path.

## See also

- Parent front door: [OpenCrane](../../README.md)
- Backend consumers: [`libs/backend`](../backend/README.md) · frontend consumers: [`libs/frontend`](../frontend/README.md)
