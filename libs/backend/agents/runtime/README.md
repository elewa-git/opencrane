# Runtime — governed workload boundaries

> [backend](../../README.md) › [agents](../README.md) › runtime

The runtime group owns shared Kubernetes mechanics for governed, class-specific worker Jobs. The
conversation-computer image and Agent Sandbox lifecycle are separate 0.11 boundaries; this group
does not claim, activate, or delete conversation-computer Pods.

## Map

| Package | What it owns |
| --- | --- |
| [`workloads/contract`](./workloads/contract/README.md) | Shared lease and binding fields for class-specific workload controllers. |
| [`workloads/k8s-controller`](./workloads/k8s-controller/README.md) | Shared exact Job adoption, release, and first-Pod mechanics. |
| [`mcp-executor`](./mcp-executor/README.md) | OCI-backed MCP server Job projection with a token-holding companion. |

```text
 product authority ── saved claim ──► class-specific controller ──► governed Job
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
- Shared workload claim contract: [runtime/workloads/contract](./workloads/contract/README.md)
- OCI-backed MCP executor: [runtime/mcp-executor](./mcp-executor/README.md)
- Execution run authority: [execution/runs](../execution/runs/main/README.md)
- Conversation computer image: [apps/conversation-computer](../../../../apps/conversation-computer/README.md)
