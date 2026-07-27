# @opencrane/server — organisation control plane and API

> [apps](../README.md) › opencrane

## What it owns

This deployable is the OpenCrane control plane for one organisation silo. A **silo** is an isolated
organisation boundary with its own application data and service credentials. The server exposes the
authenticated REST API and composes the libraries that own agents, conversations, runs, approvals,
skills, integrations, memory, artifacts, budgets, and audit evidence.

The server is the durable authority around each short-lived runtime Job:

```
 signed-in UI / channel proxy
              │ authenticated command
              ▼
 ┌──────────────────────────────────┐
 │ opencrane server  ◄── HERE        │
 │ API · policy · durable AgentRun   │
 └───────────────┬──────────────────┘
                 │ assigns one attempt
                 ▼
        agent-controller ──► isolated agent-runtime Job
                 ▲                    │
                 └── ordered events ──┘
```

**In this flow:** [opencrane-ui](../opencrane-ui/README.md) ·
[channel-proxy](../channel-proxy/README.md) · [agent-controller](../agent-controller/README.md) ·
[agent-runtime](../agent-runtime/README.md) ·
[backend capabilities](../../libs/backend/README.md)

A request creates or changes durable product state before a worker is trusted to act. Runtime input
is frozen for the accepted run attempt, and events are recorded in order before they are delivered
to clients. If identity, assignment, authorization, or ordering evidence does not match, the server
refuses the operation rather than constructing partial state.

## Public surface

`Entrypoint: src/index.ts` — creates the database and Kubernetes clients, starts the public and
workload-facing listeners, runs bounded background workers, and drains both listeners during
shutdown.

- `createApp(...)` builds the authenticated public API on port `8080`.
- `createInternalApp(...)` builds the workload-facing API on port `8081`.
- `prisma/schema/*.prisma` defines the product's durable domain models.
- `prisma/bootstrap/target-baseline.sql` defines a clean OpenCrane database.

## Boundary

This app owns composition and process lifecycle, not reusable business logic. Product capabilities
belong under [`libs/backend`](../../libs/backend/README.md); transport, authentication, and
external-service ports belong under [`libs/server/_infra`](../../libs/server/_infra/README.md).

The public and workload-facing APIs use separate listeners. The internal listener is never routed
through public ingress, and workload calls must also satisfy the identity and assignment checks of
the route they use.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:opencrane`. It may compose backend and server
libraries; no library may import this app.

## Data & persistence

PostgreSQL owns the durable product record, including `AgentService`, `AgentRevision`, `AgentRun`,
the immutable run input snapshot, conversation threads and ordered events, approvals, artifacts,
skills, membership, grants, and audit evidence.

The application starts only against the reviewed clean target baseline. Database triggers protect
the lifecycle and proof bindings that Prisma cannot express: an approval can consume its resume
token once, but a stale approval decision is rejected rather than silently rewritten. Runtime Jobs
hold attempt-scoped scratch and checkpoints; they do not replace the server's durable run,
conversation, or artifact records.

## Runtime & config

The server requires `DATABASE_URL` and organisation identity-provider configuration. The Helm unit
supplies its namespace, public and internal ports, runtime namespaces, controller identity,
ArtifactStore access, and service endpoints.

The most common process settings are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Public API listener | `8080` |
| `INTERNAL_PORT` | Workload-facing listener | `8081` |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `NAMESPACE` | Trusted server namespace | `default` |
| `AGENT_RUNTIME_PERSONAL_NAMESPACE` | Namespace for personal run Jobs | required |
| `AGENT_RUNTIME_MANAGED_NAMESPACE` | Namespace for managed run Jobs | required |
| `ARTIFACT_PREPROCESSOR_ENABLED` | Enables brokered document preprocessing | `false` |

The app is built into `dist/apps/opencrane`, imaged from `deploy/Dockerfile`, and deployed through
its app-owned Helm library chart composed by [`deploy-k8s`](../_infra/deploy-k8s/README.md).

## See also

- Parent index: [apps](../README.md)
- Composed logic: [backend capabilities](../../libs/backend/README.md)
- Sibling apps: [opencrane-ui](../opencrane-ui/README.md) ·
  [channel-proxy](../channel-proxy/README.md) ·
  [agent-controller](../agent-controller/README.md)
