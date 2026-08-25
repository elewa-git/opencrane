# Artifact preprocessing workflows

> [backend](../../../../README.md) › [artifacts](../../../README.md) › [preprocessor](../README.md) › workflows

| Package | What it owns |
|---|---|
| [contract](./contract/README.md) | The shared name, input, and retry policy for one PDF preprocessing task. |

A workflow is a saved task that can wait and continue later. When a server composition admits PDF
preprocessing, it saves the task in the same database transaction that publishes the PDF. The
controller handler uses that task to prepare one isolated PDF worker. The worker does not look for
other work.

```
 server saves PDF task ──► workflows ◄── controller handler
                              │
                              ▼
                         contract package
```

**In this flow:** [contract](./contract/README.md) · [controller](../controller/README.md) · [server artifact authority](../../../server/agents/artifacts/main/README.md).

## See also

- Parent: [artifact preprocessing](../README.md)
