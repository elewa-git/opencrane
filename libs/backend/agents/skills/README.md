# Governed skill runtime support

> [backend](../../README.md) › [agents](../README.md) › skills

| Package | What it owns |
|---|---|
| [controller](./controller/README.md) | The workflow handler that turns a saved validation task into an exact restricted Job. |
| [k8s-launcher](./k8s-launcher/README.md) | Pure, policy-validating Kubernetes Job shapes for isolated skill authoring. |
| [workflows](./workflows/README.md) | The shared task contract and transaction-bound admission for durable skill validation. |
| [worker](./worker/README.md) | The fail-closed Python acknowledgement client for the governed worker-image build. |

The server-side skills package provides browser-safe catalogue discovery; this area contains the
runtime support that turns already-authorized work into isolated workloads. It never stores skill
bytes, talks to a registry, or grants Kubernetes API access to a worker.

```
 planned SkillRevision ──► workflows ──► remote task ──► controller ──► k8s-launcher
                                                               │
                                                               └──► suspended authoring Job ──► worker acknowledgement
```

The server saves Python validation tasks with their product records. The agent controller registers
their handler and the workflow engine handles retries and restart recovery.

## See also

- Parent index: [agents](../README.md)
- Catalogue discovery: [server skills](../../server/agents/skills/main/README.md)
- Runtime support: [runtime](../runtime/README.md)
