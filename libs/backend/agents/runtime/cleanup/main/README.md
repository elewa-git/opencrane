# @opencrane/backend/agents/runtime/cleanup — exact runtime Job cleanup

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › cleanup

## What it owns

This infrastructure package is the Kubernetes side of runtime workload cleanup. The execution/runs
authority first fences an attempt in PostgreSQL and issues an exact cleanup claim; this package then
reads that deterministic Job, compares every durable authority coordinate, and requests deletion
under the Job's immutable Kubernetes identifier (UID).

```text
 execution/runs cleanup claim
          │ exact run · attempt · silo · service · revision · bootstrap
          ▼
 ┌────────────────────────────────────┐
 │ runtime/cleanup  ◄── HERE          │ read → exact compare → UID delete
 └────────────────────────────────────┘
          │ absent or deletion requested
          ▼
 execution/runs confirms durable cleanup after authoritative absence
```

**In this flow:** [execution/runs](../../../execution/runs/main/README.md) owns the claim lease,
two-observation orphan policy, and durable confirmation; [k8s-launcher](../../k8s-launcher/README.md)
owns the deterministic Job name and original workload projection.

The adapter fails closed if the Job belongs to another run, attempt, silo, service, revision,
bootstrap, namespace, or Kubernetes UID. An unassigned orphan must still be suspended. A deletion
request is not treated as confirmed absence; a later reconciliation must observe the Job gone before
the run authority can publish cleanup completion.

## Public surface

- `__CreateKubernetesRuntimeWorkloadCleanupStore(options)` — create the narrow exact-read and
  UID-preconditioned-delete adapter with a hard request deadline and process shutdown signal.
- `KubernetesRuntimeWorkloadCleanupBatchApi` — the two-method Kubernetes Batch API port.
- `KubernetesRuntimeWorkloadCleanupStore` and related projection/result types — the structural
  contract composed with the execution/runs cleanup use case.

## Boundary

Consumed only by the OpenCrane process composition. It owns no database claim, cancellation rule,
run transition, polling interval, Job creation, Job release, Pod access, or ServiceAccount. It can
read and conditionally delete Jobs in the dedicated runtime namespaces; it cannot infer authority
from a resource name or Kubernetes reachability.

## Dependency direction

Tagged `scope:agent-runtime-cleanup` and `layer:infra`; it may depend only on the pure runtime Job
launcher and shared contracts. It never imports Prisma, execution/runs, server infrastructure, or an
app. Its structural store contract preserves the backend-to-infrastructure dependency inversion.

## Runtime & config

The app supplies a Kubernetes Batch client whose Role grants only `get` and `delete` for Jobs in
the two runtime namespaces, a hard per-request deadline, and process shutdown cancellation.
Deletion always includes the UID returned by the immediately preceding read, preventing a same-name
replacement from being removed.

## See also

- Parent group: [runtime](../../README.md)
- Durable authority: [execution/runs](../../../execution/runs/main/README.md)
- Job projection: [k8s-launcher](../../k8s-launcher/README.md)
- Assignment controller: [controller](../../controller/README.md)
