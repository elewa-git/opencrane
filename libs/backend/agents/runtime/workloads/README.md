# Runtime workload contracts

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › workloads

This group holds the small shared language for claiming work that OpenCrane runs outside the main
server. It lets a controller receive the same database lease and later report the same binding facts
without deciding what the workload runs.

| Package | What it owns |
| --- | --- |
| [contract](./contract/README.md) | The shared claim and binding records for OCI-backed MCP workloads. |
| [Kubernetes controller](./k8s-controller/README.md) | Exact suspended Job adoption, UID-fenced release, and first-Pod checks. |

```text
server-owned workload record
        │ claim lease + approved profile
        ▼
workloads/contract ◄── HERE
        │ exact binding facts
        ▼
class-specific controller and executor
```

The contract does not contain a container image, archive, Kubernetes Job, or database model. Those
facts belong to the MCP or skill executor after its own admission checks.

## See also

- Parent: [runtime](../README.md)
- Children: [contract](./contract/README.md) · [Kubernetes controller](./k8s-controller/README.md)
