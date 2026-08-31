# Agents — agent product and execution domains

> [backend](../README.md) › agents

This tier holds the rules and state that make an agent behave as an agent: a durable identity and
service, a run and its attempts, a frozen input, learned memory, a persona or other context, and the
execution boundary that turns an authorised attempt into work. These concepts are
general: a personal assistant and a future managed agent both need an identity, an attempt, and a
safe execution boundary.

`personal/` is the current specialization. It owns employee-specific policy — a person's
configuration-change provenance, verified memory selection, durable personal fact metadata, and an
approved persona. Conversation modes, participant visibility, the canonical timeline, and
replay are owned by [`libs/backend/server/conversations`](../server/conversations/main/README.md).
This tier is deliberately distinct from
[`libs/backend/server`](../server/README.md), the **control plane** that governs identity,
organisation scope, gateways, and managed services. The execution and runtime packages below remain shared
agent principles rather than becoming personal-only by proximity.

## Map

| Package | What it owns |
| --- | --- |
| [`personal/configuration`](./personal/configuration/README.md) | Personal specialization: future-snapshot configuration-change provenance. |
| [`personal/memory`](./personal/memory/README.md) | Personal specialization: verified dataset and preference-fact selection. |
| [`personal/personas`](./personal/personas/README.md) | Personal specialization: persona approval process. |
| [`execution/inputs`](./execution/inputs/main/README.md) | Shared: immutable run-input assembly. |
| [`execution/admission`](./execution/admission/main/README.md) | Shared: trusted personal and managed entrypoints into immutable run admission. |
| [`execution/runs`](./execution/runs/main/README.md) | Shared: run and attempt authority. |
| [`execution/protocol`](./execution/protocol/README.md) | Shared: language-neutral command and candidate authority. |
| [`runtime`](./runtime/README.md) | Shared: warm runtime Pod claims plus class-specific worker Job controllers. |
| [`runtime/workloads/contract`](./runtime/workloads/contract/README.md) | Shared claim lease and binding fields for class-specific workloads. |
| [`runtime/workloads/k8s-controller`](./runtime/workloads/k8s-controller/README.md) | Exact Job adoption, release, and Pod checks shared by workload classes. |

```
 personal specialization                shared agent execution
 configuration · personal memory · personas ──► inputs ──► runs ──► protocol ──► claimed warm Pod
                                                     ▲
                                             admission (trusted entry)
                   │                           frozen input  attempt   bounded executor boundary
                   └── verified catalog coordinates ──► personal memory metadata
```

The diagram intentionally leaves room for future managed specializations without inventing packages
before they exist. `execution/` and `runtime/` are shared by personal and managed attempts. Neither
owns the model loop or a second run/event store.

## Dependency rule for this tier

Each domain carries `layer:backend` and its own scope (`scope:execution-runs`,
`scope:personal-configuration`, `scope:personal-memory`, `scope:personal-personas`).
A domain may import the shared models it needs, such as the agent and artifact models, plus shared
contracts (`scope:shared`) and its own scope.
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
