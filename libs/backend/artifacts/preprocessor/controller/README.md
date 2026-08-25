# @opencrane/backend/artifacts/preprocessor/controller — PDF Job controller

> [backend](../../../README.md) › [artifacts](../../README.md) › [preprocessor](../README.md) › controller

## What it owns

This package holds the controller-side definition of the saved PDF conversion task. A workflow is
saved work that can continue after a restart. The handler asks the server for one claim, creates or
adopts a suspended Job, records its Kubernetes Job and Pod IDs through the server authority, then
releases only that recorded Job.

```
 saved PDF task ──► controller ◄── server claim + binding authority
                       │
                       ▼
              suspended PDF Job ──► recorded Job and Pod IDs ──► release
```

**In this flow:** [workflow contract](../workflows/contract/README.md) · [Job builder](../k8s-launcher/README.md) · [server artifact authority](../../../server/agents/artifacts/main/README.md).

No production composition registers the handler in this slice. Its tests verify the bind-before-
release sequence without starting the existing polling worker as a one-shot Job.

## Public surface

- `__CreateArtifactPreprocessHandler` — creates the controller task definition.
- `ArtifactPreprocessHandlerOptions`, `ArtifactPreprocessKubernetesStore`, and related types define
  the server authority, Kubernetes operations, and task result the handler needs.

## Boundary

This package never uses Prisma, reads PDF bytes, grants storage access, or selects a namespace. The
server owns product state and the broker; deployment config owns the Job profile.

## Dependency direction

Tagged `scope:artifact-preprocessor-controller` and `layer:backend`, it may use the PDF Job builder,
the workflow contracts, and the shared runtime workload-claim contract only. An application
composition must provide its server and Kubernetes adapters; this package does not provide either.

## See also

- Parent: [artifact preprocessing](../README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
