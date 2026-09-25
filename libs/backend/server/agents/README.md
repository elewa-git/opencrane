# Managed-agent server capabilities

> [backend](../../README.md) › [server](../README.md) › agents

These capabilities govern managed assistants: which version may run, who may invoke it, and how
scheduled work retains its original instructions and audience. A silo is one isolated organisation.

| Capability | What it owns |
| --- | --- |
| [agent-services](./agent-services/main/README.md) | Publishes immutable assistant revisions and admits their product actions through central authorization. |
| [scheduling](./scheduling/README.md) | Saves reviewed routines, selects automatic slots and admits separate occurrences through shared contracts without repeating a saved firing. |
| [skills](./skills/main/README.md) | Exposes a browser-safe, silo-scoped catalogue of governed skill metadata. |
| [artifacts](./artifacts/main/README.md) | Finalises artifact metadata. |
| [onboarding](./onboarding/main/README.md) | Owns the first-route workflow and binds persona and bootstrap references to the signed-in organisation and identity. |

```text
agents
  ├── agent-services   published assistants
  ├── scheduling       saved routines and occurrences
  ├── skills           governed skill catalogue
  ├── artifacts        finalised output metadata
  └── onboarding       first-use workflow
```

## Dependency direction

The group supplies exact actors, resources, actions, and current lifecycle facts to IAM for a
transaction-bound decision. It must not take a direct implementation
dependency on gateways or knowledge; their results enter through public contracts.

Conversation membership, message admission, canonical timeline, and display-safe replay are owned by
[`server/conversations`](../conversations/main/README.md), not by the managed-agent group.

## See also

- Parent index: [server](../README.md)
- Shared product authorization: [authorization](../iam/authorization/main/README.md)
- Conversation membership and history: [conversations](../conversations/main/README.md)
