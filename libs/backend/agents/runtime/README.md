# Runtime — language-neutral agent execution boundaries

> [backend](../../README.md) › [agents](../README.md) › runtime

The runtime group owns the Kubernetes-specific support between canonical OpenCrane state and a
process that executes an agent. The sibling execution protocol admits commands and candidates; this
group constructs the Job and controls its exact assignment, release, and first-Pod registration.
Authenticated bootstrap exchange, model/tool-loop execution, and durable transcript ownership remain
later boundaries.

## Map

| Package | What it owns |
| --- | --- |
| [`execution/protocol`](../execution/protocol/README.md) | Admission of runtime commands and candidate output against the current durable attempt authority. |
| [`k8s-launcher`](./k8s-launcher/README.md) | Pure suspended Job construction for the dedicated runtime namespace. |
| [`controller`](./controller/README.md) | Crash-safe assignment, UID-fenced Job release, and exact first-Pod registration. |
| [`cleanup`](./cleanup/main/README.md) | Exact Job checks and UID-preconditioned deletion after durable cleanup claims. |
| [`workloads/contract`](./workloads/contract/README.md) | Shared lease and binding fields for class-specific workload controllers. |
| [`workloads/k8s-controller`](./workloads/k8s-controller/README.md) | Shared exact Job adoption, release, and first-Pod mechanics. |
| [`mcp-executor`](./mcp-executor/README.md) | OCI-backed MCP server Job projection with a token-holding companion. |

```text
OpenCrane run authority
        │ command + current attempt/assignment/fence
        ▼
execution/protocol ── accepted command/candidate
        │
        ├────► controller ──► k8s-launcher ──► suspended attempt Job
                                            │ assigned Job UID
                                            ▼
                                      conditional release
                                            │ first Pod UID
                                            └────► run authority
        └────► cleanup ─────────────────────► exact read + UID-fenced delete
```

The boundary is language-neutral: a Python, TypeScript, or future runtime must satisfy the same
versioned command, assignment, sequence, issuance/expiry, lease, and replay rules. Kubernetes types
stay isolated in the `layer:infra` launcher rather than leaking into those core decisions.

## Dependency rule for this tier

The launcher may consume Kubernetes manifest types but performs no input/output. The controller and
cleanup libraries may depend on that launcher and shared contracts; neither imports the app that
composes it. Cleanup implements the execution/runs physical store contract structurally, preserving
the backend-to-infrastructure dependency direction. Runtime packages do not import a model driver.
Canonical run/event persistence remains in its owning backend domain.

The workload contract carries only database lease and binding fields. Images, credentials, and Job
shapes remain with each workload class so the contract cannot become another admission path.

Each package barrel is a composition boundary: it exposes runnable factories and required policy
types, while reconciliation seams, Kubernetes client ports, response decoders, and manifest
protocol details remain owned inside their package.

## See also

- Parent group: [agents](../README.md)
- Current authority: [execution/protocol](../execution/protocol/README.md)
- Job contract: [runtime/k8s-launcher](./k8s-launcher/README.md)
- Assignment-and-release controller: [runtime/controller](./controller/README.md)
- Exact Job cleanup adapter: [runtime/cleanup](./cleanup/main/README.md)
- Shared workload claim contract: [runtime/workloads/contract](./workloads/contract/README.md)
- OCI-backed MCP executor: [runtime/mcp-executor](./mcp-executor/README.md)
- Execution run authority: [execution/runs](../execution/runs/main/README.md)
- Server stream transport: [agent-runtime-stream](../../server/infra/agent-runtime-stream/README.md)
