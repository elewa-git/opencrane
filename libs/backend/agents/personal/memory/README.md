# Personal memory

> [backend](../../../README.md) › [agents](../../README.md) › [personal](../README.md) › memory

This group owns the memory coordinates that a verified person may use in one admitted run. It is a
selection boundary, not a fact store: it identifies the active dataset and explicit, consented
preference facts without reading or retaining their content. The production
`__CreatePrismaPersonalSessionAssemblyAuthorities` factory composes this selector into personal run
input assembly, sharing one transaction-scoped repository between the dataset and preference reads.

An admitted run is a run whose identity and permission evidence has already passed the final checks
before OpenCrane freezes its inputs.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Identity-bound active-dataset and personal-preference selection inside the existing admission transaction. |

```
 verified identity + admission transaction
                 │
                 ▼
 ┌───────────────────────────────┐
 │ personal memory/main ◄── HERE  │  select dataset + fact coordinates
 └───────────────────────────────┘
                 │
                 ▼
frozen run input ──► memory gateway recalls fact content later
```

**In this flow:** the production personal-session factory in
[execution inputs](../../execution/inputs/main/README.md) passes selected coordinates into the
frozen input. The separate managed-session factory installs an explicit empty personal-memory policy,
so a managed run never receives a person's dataset merely because it has delegated access. [Agent
memory](../../memory/README.md) owns generic catalogue metadata and outbox intent, while the
[memory gateway](../../../../server/_infra/memory-gateway-client/README.md) remains the sole
fact-content boundary.

The factory freezes only the selected OpenCrane catalogue identifier, the gateway-native Cognee
dataset identifier, and consented preference-fact identifiers. It does not read content or call
Cognee. Recall happens later through the gateway using that frozen dataset coordinate. Live
end-to-end Cognee qualification remains pending, so the composition is not evidence that a gateway
transport has been qualified in a running environment.

The child package is tagged `scope:personal-memory` and depends only on its own scope and shared
contracts. It must not call Cognee, persist fact text, write the generic catalogue, own a transaction,
or let an identifier supplied by a request choose a dataset.

## See also

- Parent group: [personal-agent domains](../README.md)
- Generic metadata authority: [agent memory](../../memory/README.md)
- Content boundary: [memory gateway](../../../../server/_infra/memory-gateway-client/README.md)
