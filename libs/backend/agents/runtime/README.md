# Runtime — language-neutral agent execution boundaries

> [backend](../../README.md) › [agents](../README.md) › runtime

The runtime group owns the Kubernetes-specific support between canonical OpenCrane state and a
process that executes an agent. The sibling execution protocol admits commands and candidates. This
group checks Helm-owned warm Deployments, claims one exact Pod for an AgentRun, activates its fixed
network profile, and deletes the used Pod when the run ends. Authenticated bootstrap exchange,
model/tool-loop execution, and durable transcript ownership remain separate boundaries.

## Map

| Package | What it owns |
| --- | --- |
| [`execution/protocol`](../execution/protocol/README.md) | Admission of runtime commands and candidate output against the current durable attempt authority. |
| [`k8s-launcher`](./k8s-launcher/README.md) | Checks fixed warm pool profiles and candidate Pod ownership without calling Kubernetes. |
| [`controller`](./controller/README.md) | Lists generic Pods, activates one claimed profile, proves readiness, and deletes the used Pod by UID. |
| [`workloads/contract`](./workloads/contract/README.md) | Shared lease and binding fields for class-specific workload controllers. |
| [`workloads/k8s-controller`](./workloads/k8s-controller/README.md) | Shared exact Job adoption, release, and first-Pod mechanics. |
| [`mcp-executor`](./mcp-executor/README.md) | OCI-backed MCP server Job projection with a token-holding companion. |

```text
OpenCrane run authority
        │ saved AgentRun workflow task
        ▼
AgentRun workflow handler ──► controller ──► Helm-owned warm Deployment
        │                                      │ generic Pod candidates
        │ database reserves one exact UID      ▼
        └──────────────────────────────► claimed warm Pod
                                               │ activate + prove readiness
                                               ▼
                                      execution/protocol
                                               │ run terminal or cancelled
                                               ▼
                                      exact UID-fenced Pod delete
```

The boundary is language-neutral: a Python, TypeScript, or future runtime must satisfy the same
versioned command, assignment, sequence, issuance/expiry, lease, and replay rules. Kubernetes types
stay isolated in the `layer:infra` launcher rather than leaking into those core decisions.

## Dependency rule for this tier

The pool-definition package may consume Kubernetes manifest types but performs no input/output. The
controller may depend on those definitions and shared contracts; it never imports the app that
composes it. Runtime packages do not import a model driver. Canonical run, reservation, cancellation,
and event persistence remains in the execution/runs package.

The workload contract carries only database lease and binding fields. Images, credentials, warm Pod
profiles, and class-specific Job shapes remain with each workload class so the contract cannot
become another admission path.

Each package barrel is a composition boundary: it exposes runnable factories and required policy
types, while reconciliation seams, Kubernetes client ports, response decoders, and manifest
protocol details remain owned inside their package.

## See also

- Parent group: [agents](../README.md)
- Current authority: [execution/protocol](../execution/protocol/README.md)
- Warm pool contract: [runtime/k8s-launcher](./k8s-launcher/README.md)
- Exact warm Pod controller: [runtime/controller](./controller/README.md)
- Shared workload claim contract: [runtime/workloads/contract](./workloads/contract/README.md)
- OCI-backed MCP executor: [runtime/mcp-executor](./mcp-executor/README.md)
- Execution run authority: [execution/runs](../execution/runs/main/README.md)
- Server stream transport: [agent-runtime-stream](../../server/infra/agent-runtime-stream/README.md)
