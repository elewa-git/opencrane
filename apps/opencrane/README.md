# @opencrane/server — per-silo control plane & authenticated API

> [apps](../README.md) › opencrane

<!-- Deployable app. Import alias `@opencrane/server` (see package.json `name`). -->

A **deployable app** is a thin process that composes backend libraries and ships as one container. This
one is the **OpenCrane server** — the *control plane* for a single silo. A **silo** is one customer's
fully isolated slice of the platform (its own namespace, database, and users); a **control plane** is
the brain that runs that slice — it answers the API and keeps the running system matching its
configuration. One server runs per silo, so a silo stands on its own.

This is the composition and deployment root of the whole backend: business logic lives in the libraries
under [`libs/backend/*`](../../libs/backend/server/README.md), and this app wires them together and owns
process bootstrap, config, routing, the database schema, and its own Helm deployment unit.

## What it owns

OpenCrane is **API-first** — every capability is a REST endpoint, and the web UI is just one more client
of that API. This server is where those endpoints live. It plays two roles at once:

- **Request path (synchronous).** It serves the authenticated REST API — tenant, policy, model, MCP
  (Model Context Protocol, the standard for connecting tools to agents), skill, awareness, spend, audit,
  and access-token routes — by mounting routers imported from the backend domain libraries behind a
  shared auth, rate-limit, and logging pipeline.
- **Reconcile path (background).** It runs **reconcilers** — loops that watch Kubernetes custom
  resources (Tenant, AccessPolicy) and steadily drive the silo's namespace to match them, plus a
  projection loop that repairs this silo's membership against the **fleet** (the cross-silo manager that
  tracks which customers exist). A reconciler means "make reality match the spec, then check again",
  forever.

```
 signed-in client ─HTTPS /api/v1/*─► org ingress ─┐   Tenant / AccessPolicy CRs
                                                   ▼            │ watch
                              ┌────────────────────────────┐    ▼
                              │  opencrane server ◄── HERE  │◄─ reconcile loops
                              │  auth → domain routers      │   (namespace → spec)
                              └──────────────┬─────────────┘
                                     reads / writes
                                             ▼
                          Postgres  +  libs/backend/* domain logic
```

**In this flow:** [libs/backend/server](../../libs/backend/server/README.md) *(the domain routers +
reconcilers it composes)* · [opencrane-ui](../opencrane-ui/README.md) *(the main API client)* ·
[deploy-k8s](../_infra/deploy-k8s/README.md) *(the silo umbrella chart that deploys it)*

Invariant: the public API and workload-facing internal API are served on **two separate listeners**
(ports 8080 and 8081). Keeping the internal listener off the public ingress is the first boundary.
Sensitive Pod routes, including the personal-agent runtime stream, additionally verify short-lived
projected Kubernetes identity through TokenReview; explicitly network-only routes remain confined by
NetworkPolicy. If either layer were collapsed, platform-only or runtime authority could become
internet-facing.

## Public surface

`Entrypoint: src/index.ts` — boots the process: creates the Prisma and Kubernetes clients, starts the
public and internal listeners, starts the projection and OpenClaw-tenant lifecycles, and binds bounded
`SIGTERM`/`SIGINT` shutdown that drains both listeners, disconnects Prisma, and flushes telemetry.

- `createApp(prisma, customApi, coreApi, authApi)` — builds the public Express app (mounts every domain
  router). Exported so tests can drive it with injected clients.
- `createInternalApp(prisma, authApi)` — builds the internal-only Express app; each mounted route
  declares projected-workload TokenReview or explicit NetworkPolicy-only trust.

The internal controller routes TokenReview only the fixed `agent-controller` ServiceAccount in the
server namespace and `opencrane-agent-controller` audience. They let that process claim a
database-fenced run attempt and commit only the immutable UID of the suspended Job it created. A
separate durable release route lets the controller conditionally unsuspend that assigned Job and
register its exact first Pod UID. The runtime stream separately accepts the
`opencrane-agent-runtime` audience and bounded runtime-profile ServiceAccount grammar in the
explicit, separate runtime namespace. Durable assignment remains the authority for the exact
ServiceAccount, Job, Pod, run, and revision; the projected bootstrap reference and a ServiceAccount
name alone are never sufficient.
The runtime stream mints the full `start_attempt`, `resume_attempt`, and `cancel_attempt` command
lifecycle and admits candidates, so a verified Pod runs its bounded model/tool loop, proposes
external actions through the reserve-before-dispatch tool-invocation authority, pauses for deferred
approval, and stops on a positive cancel signal. The approval pause is reachable end to end (a tool
grant flagged `requiresApproval` defers and opens a pending `ApprovalRequest`); the human
approval-DECISION endpoint and the steering-INGEST surface are the operator/product plane in Phase F
(#224), so approval and steering are not yet driven by an external route.

Organisation administrators can also use `/api/v1/agent-services` to create a managed agent, edit
its next immutable revision, inspect what changed, and publish a reviewed revision. A managed agent
is a shared, organisation-owned agent rather than one person's personal agent; its allowed knowledge
scopes are attached to the specific revision, not to the service as a whole. The `run now` request is
present but deliberately refuses until the later runtime assembler can bind the managed revision to
verified fleet membership and capability evidence. It never creates a partial run while that evidence
is unavailable.

## Boundary

Composition only: it must not contain business logic — that belongs in `libs/backend/*`. Reusable
infrastructure (auth middleware, HTTP hardening, DB helpers) lives in `libs/server/_infra/*`. Nothing
imports this app; it sits at the top of the dependency graph.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:opencrane`. As an entrypoint it may compose any
`libs/backend/*` domain library, `libs/server/_infra/*`, and `@opencrane/observability`; no library may
import back into it.

## Data & persistence

Owns the silo's Prisma schema, split per domain under `prisma/schema/*.prisma`, and one app-owned
target database definition at `prisma/bootstrap/target-baseline.sql`. CloudNativePG applies that SQL
once, during `initdb` for an empty database, as the configured application owner. Physical recovery
uses the schema and protected baseline marker already stored in the backup; the database hook checks
that marker before the server release may proceed. Server startup never mutates database shape.
OpenCrane does not carry an upgrade or data-conversion path from an older product schema. The runs
slice binds every `AgentRun` to exactly one immutable `RunInputSnapshot` by run, digest, thread,
silo, service, revision and effective-contract coordinates, and commits its initial acceptance and
dispatch events in the same transaction. A partial or mismatched admission cannot commit.
Cancellation is a nonterminal cleanup phase: active runs first enter `cancelling`, cannot mint
bootstrap or proof authority there, and become `cancelled` only after exact workload cleanup records
the matching terminal event. Pending approvals close without resume authority even if their expiry
sweeper has not yet run.
Managed-agent definitions are likewise revisioned: a revision records its edit parent or restore
source and change message, while scoped knowledge attachments remain immutable once published.

## Runtime & config

Read from the environment at startup.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Public listener port | `8080` |
| `INTERNAL_PORT` | Workload-facing internal listener port | `8081` |
| `DATABASE_URL` | Postgres connection string (Prisma) | *(required)* |
| `NAMESPACE` | Silo namespace the reconcilers act on | `default` |
| `AGENT_CONTROLLER_CLAIM_LEASE_SECONDS` | Database-owned lease for one controller delivery attempt | `30` |
| `AGENT_RUNTIME_NAMESPACE` | Dedicated namespace for untrusted runtime Jobs; must differ from `POD_NAMESPACE` | *(required)* |
| `AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS` | Hard lifetime of a pending runtime workload assignment | `3600` |
| `AGENT_RUNTIME_OUTBOX_RETENTION_SECONDS` | Time to retain successfully delivered runtime handshakes before bounded cleanup | `604800` |
| `AGENT_RUNTIME_OUTBOX_PRUNE_BATCH_SIZE` | Maximum successful handshakes removed by one controller maintenance pass | `100` |
| `WATCH_NAMESPACE` | Namespace member workspaces are seeded into | falls back to `NAMESPACE` |
| `FLEET_INTERNAL_URL` | Fleet membership write-through URL; empty = standalone silo | *(empty)* |
| `OPENCRANE_API_TOKEN` | Token for fleet-internal calls | *(empty)* |
| `OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS` | Projection-repair loop cadence | `60` |

Built into `dist/apps/opencrane` by esbuild and imaged from `deploy/Dockerfile`
(`ghcr.io/elewa-git/opencrane-server`), with the repository root as build context. Its Helm chart under
`helm/` is a named-template library (Deployment, RBAC, Services, ingress, certificate, NetworkPolicy)
composed by the silo umbrella chart — see [`HELM.md`](./HELM.md).
The pod runs as uid/gid 1000 with `fsGroup: 1000`; projected ArtifactStore key files use mode `0440`,
so the non-root server can read its private lease key without making that key world-readable.
Its app-owned NetworkPolicy permits only the server's required egress classes: the CNPG-managed
PgBouncer pooler,
Kubernetes and external HTTPS, DNS, release-local LiteLLM/Cognee/Langfuse/OTEL services, tenant
gateways, the GKE metadata endpoint when selected, and the cross-namespace ArtifactStore byte plane.
Shared and BYO dependencies must use HTTPS; installations that need hostname-level external
restrictions should add Cilium FQDN policy.

## See alselewa-git

- Parent index: [apps](../README.md)
- Composed logic: [libs/backend/server](../../libs/backend/server/README.md)
- Sibling apps: [opencrane-ui](../opencrane-ui/README.md) · [artifact-service](../artifact-service/README.md) · [feat-central-agents](../feat-central-agents/README.md)
