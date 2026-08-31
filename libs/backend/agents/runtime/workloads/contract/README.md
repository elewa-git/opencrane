# @opencrane/backend/agents/runtime/workloads/contract — workload claim contract

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › [workloads](../README.md) › contract

## What it owns

This package gives the server and a workload controller one small, shared description of a claim.
A claim is a time-limited reservation for one saved unit of work. The server chooses the workload
class and a fixed deployment profile first; the controller later reports which Kubernetes workload
and first Pod it bound to that claim.

```text
server approves a workload class + profile
        │ time-limited claim and opaque reference
        ▼
┌───────────────────────────────┐
│ workload contract ◄── HERE    │
└───────────────────────────────┘
        │ claim ID + exact workload identity
        ▼
class-specific executor reports its binding
```

**In this flow:** the MCP executor proves an already-imported image before it creates an
`mcp-executor` claim. The existing [skill execution authority](../../../skills/execution/main/README.md)
keeps its own claim types and is not routed through this contract. No caller can select a profile,
container image, or Kubernetes Job through this package.

The contract is deliberately small. If it carried image details or a Job shape, it would turn an
approved claim into a second admission path. If it carried database state, it would make a transport
type into the source of truth.

## Public surface

- `RuntimeWorkloadClaimClasses` names the supported workload classes.
- `RuntimeWorkloadClaimClass` is one supported workload-class value.
- `RuntimeWorkloadClaim` carries one database-issued lease and opaque execution reference.
- `RuntimeWorkloadBinding` records the exact workload identity and lease fence reported for a claim.

## Boundary

This package has no database, HTTP, Kubernetes, image, archive, registry, queue, or executor code.
It does not decide whether a workload may run; a class-specific product authority must make that
decision before it creates a claim.

## Dependency direction

Tagged `scope:runtime-workloads` and `layer:contract`, this package imports no runtime framework.
Server, controller, MCP, and skill packages may depend on it, but it never depends on them.

## See also

- Parent: [runtime workloads](../README.md)
- Related: [runtime](../../README.md) · [skill execution](../../../skills/execution/main/README.md)
