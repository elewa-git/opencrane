# @opencrane/backend/artifacts/preprocessor/controller — PDF Job controller

> [backend](../../../README.md) › [artifacts](../../README.md) › [preprocessor](../README.md) › controller

## What it owns

This package holds the controller-side definition of the saved PDF conversion task. A workflow is
saved work that can continue after a restart. The handler asks the server for one claim, creates or
adopts a suspended Job, records its Kubernetes Job and Pod IDs through the server authority, then
releases only that recorded Job. A named one-second recovery heartbeat reloads product state and
observes the exact Job until a saved outcome authorizes deletion of that UID.

```
 saved PDF task ──► controller ◄── server claim + binding authority
                       │
                       ▼
              suspended PDF Job ──► record IDs ──► release ──► outcome ──► delete
                                                                      │ retryable
                                                                      └── sleep ──► next delivery
```

**In this flow:** [workflow contract](../workflows/contract/README.md) · [Job builder](../k8s-launcher/README.md) · [server artifact authority](../../../server/agents/artifacts/main/README.md).

The agent-controller registers this handler when the deployment enables PDF preprocessing. Its tests
verify that OpenCrane records the Job and first Pod before release, reloads a committed success or
failure, and then asks Kubernetes to delete only the saved Job UID. If the worker dies first, the
heartbeat records a fenced retryable or terminal outcome before cleanup. A retryable failure sleeps
until the server's database-owned retry time before it claims the next delivery. An ambiguous delete
response replays the same UID-fenced cleanup, and an already missing Job counts as cleaned up.

Cancelling the Absurd task itself does not authorize Job deletion. A real product cancellation path
must first save a cancelled artifact outcome and hand cleanup to work that was not itself cancelled.

## Public surface

- `__CreateArtifactPreprocessHandler` — creates the controller task definition.
- `__CreateHttpArtifactPreprocessControllerAuthority` — calls the private server claim and binding
  API with the controller's rotating token.
- `ArtifactPreprocessControllerHttpAuthorityOptions` and its fetch/token types configure that
  authenticated server adapter and its isolated test seams.
- `ArtifactPreprocessHandlerOptions`, `ArtifactPreprocessKubernetesStore`, and related types define
  the server authority, Kubernetes operations, and task result the handler needs.

## Boundary

This package never uses Prisma, reads PDF bytes, grants storage access, or selects a namespace. The
server owns product state and the broker; deployment config owns the Job profile.

## Dependency direction

Tagged `scope:artifact-preprocessor-controller` and `layer:backend`, it may use the PDF Job builder,
the workflow contracts, the shared runtime workload-claim contract, and the governed Kubernetes
controller contract only. An application composition must provide its server and Kubernetes
adapters; this package does not provide either.

## See also

- Parent: [artifact preprocessing](../README.md)
- Task facts: [workflow contract](../workflows/contract/README.md)
