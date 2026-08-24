# @opencrane/backend/agents/mcpb/controller — MCP bundle Job controller

> [backend](../../../../README.md) › [agents](../../../README.md) › [mcpb](../README.md) › controller

## What it owns

An MCP bundle is a packaged Model Context Protocol server. Before OpenCrane can trust it, a
validator checks the signed package in an isolated Kubernetes Job. This package is the small loop
that turns saved inspection work into that suspended Job. A workflow is saved background work that
can continue after a restart; the OpenCrane server owns that workflow and this package only creates
the restricted Job it asks for.

```
 saved MCP bundle inspection work
              │ claim from internal API
              ▼
 ┌─────────────────────────────────┐
 │ MCP bundle controller ◄── HERE   │  creates or adopts one suspended Job
 └───────────────┬─────────────────┘
                 │ Kubernetes Job UID
                 ▼
 OpenCrane saves the assignment ──► validator Job remains suspended
```

**In this flow:** [MCP governance](../../../server/gateways/mcp/main/README.md) ·
[validator Job builder](../../../server/gateways/mcp/validator-k8s-launcher/README.md) ·
[agent controller](../../../../../apps/agent-controller/README.md)

The database claim is the source of truth. The loop makes no Job when no claim exists, and it fails
if the database refuses to save the returned Job UID. It never starts a Job or executes a bundle.

## Public surface

- `__ReconcileNextMcpbValidation` — performs one claim, suspended-Job, and assignment pass.
- `__RunMcpbValidationController` — repeats those passes until process shutdown.
- `__CreateHttpMcpbValidationControllerAuthority` — calls the controller-only OpenCrane API.
- `__CreateKubernetesMcpbValidationControllerStore` — creates or exactly adopts suspended Jobs.
- `__ValidateMcpbValidationControllerProfile` — checks deployment-owned validator settings.

## Boundary

The caller provides the controller token, network endpoint, Kubernetes client, and fixed worker
profile. This package holds no database credential and never accepts a namespace, image, worker
identity, or Job command from a claim. The worker bootstrap API and the later Job release remain
separate pieces of the flow.

## Dependency direction

Tagged `scope:mcpb-controller`: it may depend on shared contracts and the restricted MCP bundle Job
builder. It never imports an app, database adapter, or MCP product authority.

## See also

- Parent group: [agents](../../../README.md)
- Related package: [validator Job builder](../../../server/gateways/mcp/validator-k8s-launcher/README.md)
