# Artifact preprocessing

> [backend](../../README.md) › [artifacts](../README.md) › preprocessor

Artifact preprocessing turns a published PDF into text that OpenCrane can search and use. The
server saves the work as a workflow — saved work that can wait and continue after a restart — while
the controller starts one isolated worker for that exact PDF.

| Package | What it owns |
| --- | --- |
| [controller](./controller/README.md) | The workflow handler that binds one Job and its first Pod before release. |
| [k8s-launcher](./k8s-launcher/README.md) | The fixed, suspended Kubernetes Job manifest for the PDF worker. |
| [main](./main/README.md) | The worker's bounded PDF-to-text conversion and broker protocol. |
| [workflows](./workflows/README.md) | The shared task declaration and server/controller binding contract. |

```
 server publishes PDF + saves workflow
                 │
                 ▼
controller ──► suspended Job ──► records Job and Pod IDs ──► releases worker
                 │                                             │
                 └────────────────── task-bound reference ────┘
```

**In this flow:** [controller](./controller/README.md) · [Job builder](./k8s-launcher/README.md) · [workflow contract](./workflows/contract/README.md) · [server artifact authority](../../server/agents/artifacts/main/README.md).

The controller cannot choose PDF bytes, credentials, a namespace, or a different worker image. The
server owns the PDF and the recorded bindings; deployment configuration owns the worker profile.

## Dependency rule for this group

These packages keep product authority in the server. The controller may use the task contract and
Job builder, and the worker may talk only to its server broker. Neither reaches directly into the
other's database or Kubernetes client.

## See also

- Parent index: [artifacts](../README.md)
- Server workflow seam: [workflows](../../server/infra/workflows/README.md)
