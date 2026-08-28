# @opencrane/backend/artifacts/preprocessor/workflows/contract — PDF task contract

> [backend](../../../../../README.md) › [artifacts](../../../../README.md) › [preprocessor](../../README.md) › [workflows](../README.md) › contract

## What it owns

This package gives the OpenCrane server and the agent controller the same small description of one
PDF preprocessing task: its stable name, retry policy, and identifiers. A workflow is a saved task
that can wait and continue later. Keeping this description in a shared package means neither
process imports the other process's implementation.

```
 PDF publication saves task ──► shared task contract ◄── controller runs task
                                  │
                                  ▼
                          silo id + job id only
```

The input never includes PDF bytes, credentials, a Kubernetes Job, or a storage address. The
server owns PDF and output data. The controller owns starting the one isolated worker.

## Public surface

- `ArtifactPreprocessTaskDeclaration` supplies the task name and retry policy.
- `ArtifactPreprocessTaskInput` carries the silo and saved preprocessing job identifiers.
- `ArtifactPreprocessPipelineVersions` and `ArtifactPreprocessTaskNames` keep the supported PDF
  pipeline and its task name aligned.
- `ArtifactPreprocessControllerAuthority` and its record, binding, and outcome types describe the
  private controller exchange. The server issues the claim, saves Job and Pod bindings, and records
  each completion or failure. The controller reloads that saved outcome before UID-fenced cleanup;
  a retryable outcome also carries the database-owned time for the next delivery.
- `ArtifactPreprocessRecoveryReasons` and `ArtifactPreprocessRecoveryCommand` let the controller
  report that the exact saved Job became terminal or disappeared without a worker outcome. The
  complete Job and first-Pod fence must still match.
- `ArtifactPreprocessOutcomeKinds` keeps every saved outcome tied to one exact delivery. The
  controller reloads that outcome on its one-second recovery heartbeat.
- `__ParseArtifactPreprocessTaskReceipt`, `__ParseArtifactPreprocessWorkloadBindRequest`, and
  `__ParseArtifactPreprocessPodBindRequest` reject malformed controller JSON before the server
  calls its authority. `__ParseArtifactPreprocessRecoveryRequest` additionally requires the first
  Pod and a controller-owned failure reason. They do not make an HTTP request.

## Boundary

This package has no database, HTTP, Kubernetes, or workflow-engine implementation. It describes
the task but cannot save, run, or cancel one.

## See also

- Parent: [workflows](../README.md)
