# Governed skill runtime support

> [backend](../../README.md) › [agents](../README.md) › skills

| Package | What it owns |
|---|---|
| [controller](./controller/README.md) | The outbound reconciliation that turns a fenced workload claim into an exact still-suspended Job. |
| [execution](./execution/main/README.md) | The retained database authority for tool-runner claim, assignment, release, and bootstrap fences. |
| [k8s-launcher](./k8s-launcher/README.md) | Pure, policy-validating Kubernetes Job shapes for isolated skill authoring and tool execution. |
| [workflows](./workflows/README.md) | The shared task contract and transaction-bound admission for durable skill validation. |
| [worker](./worker/README.md) | The fail-closed Python acknowledgement client for the governed worker-image build. |

The server-side skills package provides browser-safe catalogue discovery; this area contains the
runtime support that turns already-authorized work into isolated workloads. It never stores skill
bytes, talks to a registry, or grants Kubernetes API access to a worker.

```
 planned SkillRevision ──► workflows ──► remote task ──► controller ──► k8s-launcher
                                                               │
                                                               └──► suspended authoring / tool Job ──► worker acknowledgement
```

The server saves Python validation tasks with their product records. The agent controller registers
their handler, while the older database-polled path remains only for published tool-runner skills.

## See also

- Parent index: [agents](../README.md)
- Catalogue discovery: [server skills](../../server/agents/skills/main/README.md)
- Runtime support: [runtime](../runtime/README.md)
