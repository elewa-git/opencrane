# Personal memory

> [backend](../../../README.md) › [agents](../../README.md) › [personal](../README.md) › memory

This group owns the memory coordinates that a verified person may use in one admitted run. It is a
selection boundary, not a fact store: it identifies the active dataset and explicit, consented
preference facts without reading or retaining their content. The
`__CreatePrismaPersonalSessionAssemblyAuthorities` factory is selected by the production
personal-run admission path. It binds the dataset and preference readers to the same admission
transaction so both decisions see the same verified identity and revocation fence.

An admitted run is a run whose identity and permission evidence has already passed the final checks
before OpenCrane freezes its inputs.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Identity-bound active-dataset and personal-preference selection inside the existing admission transaction. |

```
 POST /api/v1/me/conversations/:conversationId/messages  { conversationId · requestIdempotencyKey }
                 │ session subject + host silo + participant conversation
                 ▼
 ┌───────────────────────────────┐
 │ personal memory/main ◄── HERE  │  select dataset + fact coordinates
 └───────────────────────────────┘
                 │
                 ▼
frozen run input ──► memory gateway recalls fact content later
```

**In this flow:** [execution admission](../../execution/admission/main/README.md) derives the subject
and silo from trusted request facts, resolves the participant-bound personal service, and enters the
final snapshot transaction. [Execution inputs](../../execution/inputs/main/README.md) then verifies
the signed membership and current grants before this package selects memory coordinates. The managed
session factory still installs an explicit empty personal-memory policy, so a managed run never
receives a person's dataset merely because it has delegated access. [Agent memory](../../memory/README.md)
owns generic catalogue metadata and outbox intent, while the
[memory gateway](../../../../server/_infra/memory-gateway-client/README.md) remains the sole
fact-content boundary.

The production path freezes only the selected OpenCrane catalogue identifier, the gateway-native
Cognee dataset identifier, and consented preference-fact identifiers. It does not read content or
call Cognee. Recall happens later through the gateway using that frozen dataset coordinate. Live
end-to-end Cognee qualification remains pending, so production admission does not by itself prove
that the gateway transport works in a running environment.

The child package is tagged `scope:personal-memory` and depends only on its own scope and shared
contracts. It must not call Cognee, persist fact text, write the generic catalogue, own a transaction,
or let an identifier supplied by a request choose a dataset.

## See also

- Parent group: [personal-agent domains](../README.md)
- Trusted entry: [execution admission](../../execution/admission/main/README.md)
- Generic metadata authority: [agent memory](../../memory/README.md)
- Content boundary: [memory gateway](../../../../server/_infra/memory-gateway-client/README.md)
