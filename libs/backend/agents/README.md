# Agents — agent product and execution domains

> [backend](../README.md) › agents

This tier holds the rules and state that make an agent behave as an agent: a durable identity and
service, a conversation, a run and its attempts, a frozen input, learned memory, a persona or other
context, and the execution boundary that turns an authorised attempt into work. These concepts are
general: a personal assistant and a future managed agent both need an identity, an attempt, and a
safe execution boundary.

`personal/` is the current specialization. It owns the employee-specific persistence and policy — a
person's conversations, memory facts, and approved persona. It is deliberately distinct from
[`libs/backend/server`](../server/README.md), the operator **control plane** that governs people,
tenancy, gateways, and fleet-wide services. The execution and runtime packages below remain shared
agent principles rather than becoming personal-only by proximity.

## Map

| Package | What it owns |
| --- | --- |
| [`personal/conversations`](./personal/conversations/main/README.md) | Personal specialization: append-only user-visible event history. |
| [`personal/configuration`](./personal/configuration/main/README.md) | Personal specialization: future-snapshot configuration-change provenance. |
| [`personal/memory`](./personal/memory/main/README.md) | Personal specialization: memory-fact catalogue and policy. |
| [`personal/personas`](./personal/personas/main/README.md) | Personal specialization: persona approval process. |
| [`execution/inputs`](./execution/inputs/main/README.md) | Shared: immutable run-input assembly. |
| [`execution/runs`](./execution/runs/main/README.md) | Shared: run and attempt authority. |
| [`execution/protocol`](./execution/protocol/README.md) | Shared: language-neutral command and candidate authority. |
| [`runtime`](./runtime/README.md) | Shared: Kubernetes Job projection and controller. |

```
 personal specialization                shared agent execution
conversations · memory · personas · configuration  ──► inputs ──► runs ──► protocol ──► runtime Job
 employee-specific state                  frozen input  attempt   bounded executor boundary
```

The diagram intentionally leaves room for future managed specializations without inventing packages
before they exist. `execution/` and `runtime/` are shared by personal and managed attempts. Neither
owns the model loop or a second run/event store.

## Dependency rule for this tier

Each domain carries `layer:backend` and its own scope (`scope:execution-runs`,
`scope:personal-conversations`, `scope:personal-configuration`, `scope:personal-memory`,
`scope:personal-personas`). A domain may
import the shared models it needs — the agent model (`scope:agents`), and for runs the authorization
model, for memory the artifacts model — plus shared contracts (`scope:shared`) and its own scope.
It may **not** import an unrelated specialization or a control-plane (`libs/backend/server`) domain.
Cross-domain contact happens above, in the app that composes them. Never import an app.

One deliberate exception: `execution/inputs` (`scope:execution-inputs`) is the assembly step that
sits *across* the domains, so its constraint additionally allows `scope:execution-runs` (the
admission transaction it compiles into), `scope:membership` (verified identity evidence), and
`scope:artifacts` — see the `depConstraint` in `eslint.config.mjs`.

`execution/protocol` may additionally consume the shared agent model, run/conversation/authorization
ports, and contracts required to validate an attempt. Neither it nor the runtime controller can import
an app, transport adapter, or model driver.

## See also

- Parent index: [`libs/backend`](../README.md)
- Sibling group: [`libs/backend/server`](../server/README.md) (the operator control plane) · [`libs/backend/artifacts`](../artifacts/README.md)
