# @opencrane/backend/agents/execution/runs/controller — AgentRun workflow executor

> [agent-run authority](../main/README.md) › controller

## What it owns

This package defines the handler that will run one saved AgentRun task in the agent controller. A
workflow is saved work that can pause and continue after a restart. Application composition does not
register this handler yet: the later cutover will replace the old controller-wide attempt and release
polling loop while reusing the existing suspended Job, Job UID, first Pod, and runtime bootstrap rules.

The server still decides whether an attempt may run and stores every lifecycle update. This package
only turns that approved attempt into its one Kubernetes Job.

```text
 saved AgentRun task
          │ approved run and fixed profile
          ▼
 ┌──────────────────────────────────┐
 │ AgentRun controller  ◄── HERE     │
 └──────────────────────────────────┘
          │ suspended Job, then first Pod
          ▼
 runtime worker ──► server-owned terminal state
```

**In this flow:** [task vocabulary](../workflows/contract/README.md) · [runtime controller](../../../runtime/controller/README.md)

The Job stays suspended until the server records its Kubernetes-issued identifier. On a restart, the
handler reloads the server's current task facts before it creates Kubernetes work. A malformed, stale,
cancelled, or retried task therefore stops before it can start a different attempt.

## Public surface

- `__CreateAgentRunWorkflowHandler` builds the controller task definition.
- The exported types define its server authority, Kubernetes adapter, fixed profiles, and task facts.

## Boundary

It must not decide the run state, load a database directly, create an OCI workload, or use the
generic warm agent Pod. The runtime profile remains fixed by deployment configuration.

## Dependency direction

This `scope:execution-runs` infrastructure package may use the AgentRun task contract and runtime
controller boundary. It must not import application composition, Prisma, OCI admission, or warm-pool
implementation details.

## See also

- Parent: [AgentRun authority](../main/README.md)
- Task vocabulary: [workflow contract](../workflows/contract/README.md)
- Existing Kubernetes boundary: [runtime controller](../../../runtime/controller/README.md)
