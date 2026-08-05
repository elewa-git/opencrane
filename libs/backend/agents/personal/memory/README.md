# Personal memory

> [backend](../../../README.md) › [agents](../../README.md) › [personal](../README.md) › memory

This group owns the memory coordinates that a verified person may use in one admitted run. It is a
selection boundary, not a fact store: it identifies the active dataset and explicit, consented
preference facts without reading or retaining their content. The selection owner is not yet wired
into a production personal-session assembler, so this is a prepared boundary rather than a live
personal-memory path.

An admitted run is a run whose identity and permission evidence has already passed the final checks
before OpenCrane freezes its inputs.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Identity-bound active-dataset and personal-preference selection inside the existing admission transaction. |

```
 target flow: verified identity + admission transaction
                 │
                 ▼
 ┌───────────────────────────────┐
 │ personal memory/main ◄── HERE  │  select dataset + fact coordinates
 └───────────────────────────────┘
                 │
                 ▼
frozen run input ──► memory gateway recalls fact content later
```

**In this target flow:** a future personal-session assembler passes selected coordinates to
[execution inputs](../../execution/inputs/main/README.md), which freezes them; [agent memory](../../memory/README.md)
owns generic catalogue metadata and outbox intent; and the
[memory gateway](../../../../server/_infra/memory-gateway-client/README.md) is the sole fact-content
boundary.

The child package is tagged `scope:personal-memory` and depends only on its own scope and shared
contracts. It must not call Cognee, persist fact text, write the generic catalogue, own a transaction,
or let an identifier supplied by a request choose a dataset.

## See also

- Parent group: [personal-agent domains](../README.md)
- Generic metadata authority: [agent memory](../../memory/README.md)
- Content boundary: [memory gateway](../../../../server/_infra/memory-gateway-client/README.md)
