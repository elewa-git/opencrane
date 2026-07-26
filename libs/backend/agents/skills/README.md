# Governed skill runtime support

> [backend](../../README.md) › [agents](../README.md) › skills

| Package | What it owns |
|---|---|
| [controller](./controller/README.md) | The outbound reconciliation that turns a fenced workload claim into an exact still-suspended Job. |
| [execution](./execution/main/README.md) | The controller-only Postgres claim and immutable suspended-Job assignment fence. |
| [k8s-launcher](./k8s-launcher/README.md) | Pure, policy-validating Kubernetes Job shapes for isolated skill authoring and tool execution. |
| [worker](./worker/README.md) | The fail-closed Python acknowledgement client for the governed worker-image build. |

Skill catalog lifecycle remains under `backend/server/agents/skills`; this area contains the runtime
support that turns already-authorized work into isolated workloads. It never stores skill bytes,
talks to a registry, or grants Kubernetes API access to a worker.

```
 SkillRevision authority ──► execution fence ──► controller ──► k8s-launcher
                                                   │
                                                   └──► suspended authoring / tool Job ──► worker acknowledgement
```

## See also

- Parent index: [agents](../README.md)
- Catalog authority: [server skills](../../server/agents/skills/main/README.md)
- Runtime support: [runtime](../runtime/README.md)
