# Conversational scheduling

> [backend](../../../README.md) › [server](../../README.md) › [agents](../README.md) › scheduling

These packages turn reviewed routine instructions into separate assistant occurrences. Each
occurrence keeps its original request and audience while current permissions control new work.

| Package | What it owns |
| --- | --- |
| [main](./main/README.md) | Routine lifecycle, current authorization checks, saved firing records and durable workflow tasks. |
| [contract](./contract/README.md) | Shared preparation, computer activation and run-admission ports and validated receipts. |

```text
scheduling
  ├── main       routine state and workflow
  └── contract   shared occurrence inputs and receipts
```

## Dependency direction

The main package uses the contract. Conversation adapters may implement its ports without
depending on scheduling persistence or lifecycle code. The contract may depend on pure agent
models, shared utilities and the public workflow contract, never either implementation.

## See also

- Parent index: [agents](../README.md)
- Occurrence history and execution: [conversations](../../conversations/README.md)
