# @opencrane/backend/artifacts/preprocessor/workflows/contract — PDF task contract

> [backend](../../../../../README.md) › [artifacts](../../../../README.md) › [preprocessor](../../README.md) › [workflows](../README.md) › contract

## What it owns

This package gives the OpenCrane server and the agent controller the same small description of one
PDF preprocessing task: its stable name, retry policy, and identifiers. A workflow is a saved task
that can wait and continue later. Keeping this description in a shared package means neither
process imports the other process's implementation.

```
 PDF publication will save task ──► shared task contract ◄── controller will run task
                                      │
                                      ▼
                              silo id + job id only
```

The input never includes PDF bytes, credentials, a Kubernetes Job, or a storage address. The
server owns PDF and output data. The controller owns starting the one isolated worker.

## Public surface

- `ArtifactPreprocessTaskDeclaration` supplies the task name and retry policy.
- `ArtifactPreprocessTaskInput` carries the silo and saved preprocessing job identifiers.
- `ArtifactPreprocessTaskNames` names the supported PDF conversion task.
- `ArtifactPreprocessControllerAuthority` and its record/bind types describe the private controller
  exchange. The server issues and persists the claim and bindings; the controller supplies fenced
  Job and Pod identities for the server to record.
- `__ParseArtifactPreprocessTaskReceipt`, `__ParseArtifactPreprocessWorkloadBindRequest`, and
  `__ParseArtifactPreprocessPodBindRequest` reject malformed controller JSON before the server
  calls its authority. They check the saved task, bootstrap reference, delivery fence, and worker
  namespace; they do not make an HTTP request.

## Boundary

This package has no database, HTTP, Kubernetes, or workflow-engine implementation. It describes
the task but cannot save, run, or cancel one.

## See also

- Parent: [workflows](../README.md)
