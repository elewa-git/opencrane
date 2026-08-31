# @opencrane/backend/agents/execution/runs/controller — AgentRun workflow handler

> [agent-run authority](../main/README.md) › controller

## What it owns

A **workflow** is a saved task that can continue after a restart. This package defines the Absurd
handler for one AgentRun attempt.

```text
 saved AgentRun task
        │
        ▼
 ┌────────────────────────────────────┐
 │ AgentRun workflow handler ◄── HERE │
 │ find a generic warm Pod            │
 └────────────────────────────────────┘
        │
        ▼
 reserve it in the database
        │
        ▼
 activate profile → prove readiness → let Pod bind
        │
        ▼
 watch the exact claimed Pod while the run works
        │ dead while waiting → fence and claim a fresh Pod
        │ dead while working → require recovery; never replay model work
        │
        ▼
 delete the used Pod
```

**In this flow:** [workflow contract](../workflows/contract/README.md) · [runtime controller](../../../runtime/controller/README.md)

Absurd checkpoints each binding generation's Kubernetes steps. If the controller restarts, it
resumes the same saved task. A replacement uses a new generation, so a stale Pod cannot reconnect as
the current runtime. Before it reserves that replacement, the handler finishes any older saved Pod
deletion that a prior controller process did not record.

## Public surface

- `__CreateWarmAgentRunWorkflowHandler(options)` creates the saved task handler.
- `__CreateHttpWarmAgentRunWorkflowControllerAuthority(options)` connects the handler to the
  server-owned run authority.
- The exported option types define the fixed warm profiles, Kubernetes adapter, polling interval,
  and private server client.

## Boundary

The handler does not read the database, choose a container image, or trust Kubernetes labels as run
authority. The server decides whether a Pod may be reserved and whether each saved lifecycle update
is still current. The Kubernetes adapter performs only the requested read, profile change, readiness
probe, or UID-checked deletion.

This handler runs the normal AgentRun runtime only. OCI-backed MCP and code-skill workloads have
their own executor class.

## Dependency direction

Tagged `scope:execution-runs` and `layer:infra`: it may depend on the AgentRun workflow contract and
runtime-controller ports. It never imports application composition, Prisma, or OCI admission.

## See also

- [AgentRun authority](../main/README.md)
- [Workflow contract](../workflows/contract/README.md)
- [Warm Kubernetes controller](../../../runtime/controller/README.md)
- [Warm pool definitions](../../../runtime/k8s-launcher/README.md)
