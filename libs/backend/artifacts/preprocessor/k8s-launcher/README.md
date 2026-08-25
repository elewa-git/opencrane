# @opencrane/backend/artifacts/preprocessor/k8s-launcher — PDF worker Job builder

> [backend](../../../../../README.md) › [artifacts](../../../../README.md) › preprocessor › k8s-launcher

## What it owns

This package builds the Kubernetes Job for one PDF-to-text conversion. The builder is pure: it
does not call Kubernetes, open a database connection, access artifact storage, or run a PDF. The
agent controller is the only process that may submit the Job it produces.

```
 durable task + opaque bootstrap reference
                    │
                    ▼
 ┌───────────────────────────────────────────────┐
 │ preprocessor/k8s-launcher  ◄── HERE            │ validates fixed image, identity, token,
 └───────────────────────────────────────────────┘ resource limits, and temporary scratch
                    │
                    ▼
 agent controller ──► one isolated Kubernetes Job
```

The Job is suspended when created. The controller records its Kubernetes UID before releasing it.
The worker receives an audience-bound token and an opaque bootstrap reference in separate read-only
files. It can use them only with the OpenCrane internal broker; it never receives database or
artifact-store credentials.

## Public surface

- `__BuildArtifactPreprocessorJob` creates the deterministic hardened Job manifest.
- `ArtifactPreprocessorJobProfile` holds deployment-owned image, identity, resource, and token
  policy.
- `ArtifactPreprocessorJobAssignment` holds the controller-selected task coordinates.

## Boundary

The controller consumes this builder. It does not schedule work, issue a capability, or contact the
server. The server verifies the worker's projected token and durable job binding before serving any
PDF bytes or accepting output.

## See also

- Parent: [artifacts](../../../README.md)
- Worker process: [preprocessor](../main/README.md)
