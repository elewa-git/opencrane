# @opencrane/server — organisation control plane and API

> [apps](../README.md) › opencrane

## What it owns

This deployable is the control plane for one organisation **silo**: an isolated customer boundary
with its own product data and service credentials. It exposes the authenticated product API, admits
agent runs into durable state, serves workload-only coordination endpoints, and manages the shared
database and client lifecycles for that process.

The app is a composition root. Libraries own the behaviour for agents, conversations, runs,
approvals, skills, integrations, memory, artifacts, budgets, and audit evidence; this app chooses
their concrete adapters, mounts their routers, and starts and stops them in the correct order.

```
 signed-in UI / channel proxy                cluster workloads
              │ browser session                    │ projected identity
              ▼                                    ▼
 ┌──────────────────────────┐          ┌──────────────────────────┐
 │ public API :8080          │          │ internal API :8081       │
 │ product routes           │          │ controller/runtime ports │
 └────────────┬─────────────┘          └────────────┬─────────────┘
              └──────────────┬──────────────────────┘
                             ▼
                  ┌───────────────────────┐
                  │ PostgreSQL authority  │
                  │ runs · policy · audit │
                  └───────────┬───────────┘
                              ▼
                     agent-controller
                              │
                              ▼
                     isolated runtime Job
```

**In this flow:** [opencrane-ui](../opencrane-ui/README.md) ·
[channel-proxy](../channel-proxy/README.md) · [agent-controller](../agent-controller/README.md) ·
[agent-runtime](../agent-runtime/README.md) ·
[backend capabilities](../../libs/backend/README.md)

Startup proceeds in five visible stages:

1. initialise telemetry before any instrumented dependency loads;
2. freeze process configuration and construct Prisma and Kubernetes clients;
3. compose one managed-run admission port shared by HTTP run-now and scheduled runs;
4. build the public and internal Express applications; and
5. start both listeners and bounded workers under one coordinated shutdown path.

The route registry is deliberately a catalogue rather than a second application layer:

| Listener | Area | What is mounted |
| --- | --- | --- |
| Public `:8080` | Identity and access | audit, groups, grants, resource shares |
| Public `:8080` | Agents | agent-service management and governed skill catalogue |
| Public `:8080` | Personal workspace | assets, persona onboarding, approvals, runs, configuration, conversations |
| Public `:8080` | Gateways | MCP, model routing, providers, bring-your-own-key, model registry |
| Public `:8080` | Knowledge and reporting | retrieval sources, budgets, token usage |
| Internal `:8081` | Controller | run-attempt and skill-workload dispatch |
| Internal `:8081` | Runtime | one-use bootstrap, command stream, candidate ingest, skill-authoring exchange |
| Internal `:8081` | Workers and replay | artifact preprocessing and controller-selected conversation replay |

The invariant is simple: a request creates or changes durable product state before a worker is
trusted to act. Runtime input is frozen for the accepted attempt, and events are recorded in order
before clients receive them. Missing or mismatched identity, assignment, authorization, or ordering
evidence produces a refusal, never partial authority.

## Public surface

`Entrypoint: src/index.ts` — a short, telemetry-first `_Main()` that composes the process and hands
its resources to the lifecycle owner.

- `src/app/config.ts` reads one startup snapshot for listener and worker configuration.
- `src/app/kubernetes-clients.ts` constructs the exact Kubernetes clients the process needs.
- `src/app/public-app.ts` builds the browser-session-authenticated API.
- `src/app/internal-app.ts` builds the workload-facing API on its separate socket.
- `src/app/routes.ts` contains only named per-area route lists and the trivial mount loop.
- `src/app/runtime-composition.ts` binds controller, skill-workload, runtime, and optional-worker
  authorities by caller plane without choosing transport paths.
- `src/app/background-workers.ts` owns schedule ticks, expired-run repair, and fenced cleanup loops.
- `src/app/lifecycle.ts` starts both listeners, stops producers first, drains requests, disconnects
  Prisma, and flushes telemetry.
- `prisma/schema/*.prisma` defines the product's durable domain models.
- `prisma/bootstrap/target-baseline.sql` defines a clean OpenCrane database.

## Boundary

This app owns process composition, app-specific configuration, listeners, and shutdown. Reusable
product behaviour belongs under [`libs/backend`](../../libs/backend/README.md); authentication,
transport, and external-service seams belong under
[`libs/server/_infra`](../../libs/server/_infra/README.md). Libraries never import this app.

The public and workload-facing APIs share a process but not an exposure boundary. Public ingress
routes only to `:8080`. The `:8081` Service is restricted by Kubernetes NetworkPolicy, and endpoints
that grant workload authority additionally review the caller's projected Kubernetes identity and
bind it to durable assignment evidence.

### Why run admission stays in this process

Managed run admission is not an agent proxy and does not execute an agent session. It synchronously
combines three existing product authorities:

1. verify the managed agent service and its current signed membership evidence;
2. assemble one immutable input snapshot from the active revision and effective grants; and
3. persist the run and admission outcome in the canonical transaction.

One process-local capacity gate protects the database pool and is shared by both run-now requests
and the scheduler. The reusable composition lives in
[`execution/admission`](../../libs/backend/agents/execution/admission/main/README.md); this app only
constructs and injects the port.

Moving admission into another deployable now would add a network and availability boundary without
giving it independent data, credentials, lifecycle, or scaling. A future agent-session gateway
would become justified only when workload streams need their own rollout/scaling lifecycle,
identity, queue or persistence boundary, and a versioned authenticated contract back to the product
authority. Until then the existing internal listener is the narrower boundary.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:opencrane`. It may compose backend and
server-infrastructure libraries. No library may import app source, and this app may not import
another deployable's source.

## Data & persistence

PostgreSQL owns the durable product record: agent services and revisions, runs and immutable input
snapshots, conversation threads and ordered events, approvals, artifacts, skills, membership,
grants, provider configuration, spend, and audit evidence.

Database triggers protect lifecycle and proof bindings that Prisma cannot express alone. Runtime
Jobs hold attempt-scoped scratch and checkpoints; they do not replace the server's run,
conversation, approval, or artifact records.

## Runtime & config

The Helm unit supplies the database, OpenID Connect (OIDC) sign-in settings, namespaces, mounted
verification and signing keys, internal service endpoints, and listener settings. Important groups
are:

| Configuration | Purpose | Default |
| --- | --- | --- |
| `PORT` / `INTERNAL_PORT` | Public and workload-facing listeners | `8080` / `8081` |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `OIDC_*` | Organisation sign-in, callbacks, and server-side session protection | required |
| `POD_NAMESPACE` | Trusted namespace of this server and controller identity | `default` |
| `AGENT_RUNTIME_PERSONAL_NAMESPACE` | Personal runtime Job boundary | required |
| `AGENT_RUNTIME_MANAGED_NAMESPACE` | Managed runtime Job boundary | required |
| `AGENT_RUN_ADMISSION_*` | Active and queued managed-admission limits | bounded defaults |
| `OPENCRANE_FLEET_MEMBERSHIP_*` | Signed managed-service membership trust | required for admission |
| `OPENCRANE_SCHEDULER_*` | Optional scheduled-run loop and interval | disabled |
| `ARTIFACT_SERVICE_URL` and mounted artifact keys | Private byte promotion/read brokers | required when used |
| `ARTIFACT_PREPROCESSOR_*` | Restricted preprocessing worker and output ceiling | disabled |
| `CHANNEL_REPLAY_ROUTE_ID` | Exact internal replay policy-enforcement route | disabled when absent |

The app builds into `dist/apps/opencrane`, uses `deploy/Dockerfile`, and ships through its app-owned
Helm library chart, which [`deploy-k8s`](../_infra/deploy-k8s/README.md) composes into a release.

## See also

- Parent index: [apps](../README.md)
- Composed logic: [backend capabilities](../../libs/backend/README.md) ·
  [server infrastructure](../../libs/server/_infra/README.md)
- Sibling apps: [opencrane-ui](../opencrane-ui/README.md) ·
  [channel-proxy](../channel-proxy/README.md) ·
  [agent-controller](../agent-controller/README.md)
