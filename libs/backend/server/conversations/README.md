# Conversations

> [backend](../../README.md) › [server](../README.md) › conversations

Conversations keep ordered participant history separate from current database permissions and from
the computer that runs an assistant's work.

| Package | Owns |
| --- | --- |
| [main](./main/README.md) | Participant APIs, membership checks, creation, child work, and computer operation orchestration. |
| [history](./history/README.md) | Validated timeline reads and appends, encrypted payloads, and a computer's bound writer. |
| [computers](./computers/README.md) | Computer and lease snapshots checked against their KurrentDB event stream. |

```text
main ──► history ──► history-store
  └────► computers ──► history-store
```

The two history packages depend on contracts, models and the history-store port. They never import
participant orchestration or database permissions from `main`. Main rechecks authorisation before
using either package; neither an event nor a computer lease grants permission by itself.

## See also

- [Server](../README.md)
- [History store](../infra/history-store/README.md)
- [Conversation models](../../../models/conversations/main/README.md)
