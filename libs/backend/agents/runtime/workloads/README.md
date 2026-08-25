# Runtime workload contracts

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › workloads

This group holds the small shared language for claiming a workload that OpenCrane will run outside
the main server. It lets a controller receive the same durable lease and later report the same
binding facts without deciding what the workload runs.

| Package | What it owns |
| --- | --- |
| [contract](./contract/README.md) | The shared claim and binding records for MCP and skill workloads. |

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
facts belong to the class-specific MCP or skill executor after its own admission checks.

## See also

- Parent: [runtime](../README.md)
- Child: [contract](./contract/README.md)
