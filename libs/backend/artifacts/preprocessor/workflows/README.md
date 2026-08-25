# Artifact preprocessing workflows

> [backend](../../../../../README.md) › [artifacts](../../../../README.md) › preprocessor › workflows

| Package | What it owns |
|---|---|
| [contract](./contract/README.md) | The shared name, input, and retry policy for one PDF preprocessing task. |

A workflow is a saved task that can wait and continue later. When a server composition admits PDF
preprocessing, it will save the task in the same database transaction that publishes the PDF. The
controller will run it and start one isolated PDF worker for that task. The worker does not look for
other work.

## See also

- Parent: [artifact preprocessing](../main/README.md)
