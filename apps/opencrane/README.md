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

Startup proceeds in six visible stages:

1. initialise telemetry before any instrumented dependency loads;
2. freeze process configuration and construct Prisma and Kubernetes clients;
3. when configured, seed the initial provider credential through LiteLLM before serving any agent;
4. compose one shared-capacity managed admission port and one session-derived personal admission
   port, both over the same signed membership configuration. A standalone deployment has no Fleet
   key but deliberately denies run admission until it has a local signed-membership issuer;
5. build the public and internal Express applications; and
6. start the registered workflow and bounded background workers, then open both listeners and attach
   the signed-in conversation WebSocket under one coordinated shutdown path.

The route registry is deliberately a catalogue rather than a second application layer:

| Listener | Area | What is mounted |
| --- | --- | --- |
| Public `:8080` | Identity and access | audit, groups, grants, resource shares |
| Public `:8080` | Agents | agent-service management and governed skill catalogue |
| Public `:8080` | Personal workspace | guided onboarding, assets, persona, approvals, runs, configuration, conversations |
| Public `:8080` | Gateways | MCP catalogue, OCI image promotion, model routing, providers, bring-your-own-key, model registry |
| Public `:8080` | Knowledge and reporting | retrieval sources, budgets, token usage |
| Internal `:8081` | Controller | run-attempt, skill-workload, and OCI MCP Job dispatch |
| Internal `:8081` | Runtime | one-use bootstrap, command stream, candidate ingest, skill-authoring exchange |
| Internal `:8081` | Workers and replay | Pod-bound MCP command/result exchange, artifact preprocessing, and controller-selected conversation replay |

The invariant is simple: a request creates or changes durable product state before a worker is
trusted to act. Runtime input is frozen for the accepted attempt, and events are recorded in order
before clients receive them. Missing or mismatched identity, assignment, authorization, or ordering
evidence produces a refusal, never partial authority.

Both conversation routes compose the transport-neutral
[conversation projection package](../../libs/backend/conversations/projection/main/README.md). It
turns authorised direct, group and agent-session timelines into the same safe, resumable browser
stream while this app keeps authentication, Prisma and listener ownership. The browser transport is
a same-origin WebSocket on the public listener: the app restores the existing cookie session before
the upgrade, rejects a cross-origin request, and closes active sockets before Prisma drains.

## Public surface

`Entrypoint: src/index.ts` — a short, telemetry-first `_Main()` that composes the process and hands
its resources to the lifecycle owner.

- `src/app/config.ts` reads one startup snapshot for listener and worker configuration, including
  the all-or-nothing standalone first-owner contract and HTTPS-only Fleet membership receiver.
- `src/app/initial-model-bootstrap.ts` makes the deployment-supplied provider key available through
  the existing provider-custody and LiteLLM-registration authority before the listeners start.
- `src/app/kubernetes-clients.ts` constructs the exact Kubernetes clients the process needs.
- `src/app/public-app.ts` builds the browser-session-authenticated API.
- The neutral [membership](../../libs/backend/server/iam/membership/main/README.md) package owns
  common mounted-key fleet-membership verifier configuration used by both admission paths.
- `src/app/internal-app.ts` builds the workload-facing API on its separate socket.
- `src/app/routes.ts` contains named per-area route lists and app-owned transport composition. The
  sharing authority is mounted behind the shared per-IP limiter before identity or database work.
- `src/app/runtime-composition.ts` binds controller, skill-workload, runtime, and optional-worker
  authorities by caller plane without choosing transport paths.
- `src/app/mcp-workflow-composition.ts` creates one Absurd worker for remote MCP protocol checks
  and OCI image admission. A workflow is saved work that may continue after the server restarts.
  Here it checks a registered server, validates a saved OCI Image Layout ZIP, imports the accepted
  image into the configured registry, and saves its immutable digest without keeping the request open.
- `src/app/mcp-runtime-composition.ts` turns that immutable image into a separate MCP executor Job.
  It shares one database authority across the administrator promotion route, controller claims,
  Pod-bound companion reports, and saved tool calls, so no generic worker can also run the call.
- `src/app/persona-approval-composition.ts` adapts agent-service persona selection to the persona
  approval port on one Serializable transaction. It maps agent outcomes but owns no persona or
  AgentRevision persistence.
- `src/infra/artifacts/*` is one app-only artifact-broker composition slice. It binds the server's
  mounted lease keys, exact same-silo `artifact-service` route, and durable artifact authority into
  source, read, upload, and output brokers; those pieces are inseparable from this process's private
  configuration and do not expose a reusable ArtifactStore client.
- `src/infra/obot/*` composes custody and server-side Model Context Protocol (MCP) invocation over
  one authenticated, bounded Obot session. With no Obot configuration both ports refuse closed.
- `src/app/background-workers.ts` owns the Absurd worker, schedule ticks, durable external-action
  passes, expired-run repair, and fenced cleanup loops. Shutdown lets active work finish before
  Prisma closes.
- `src/app/external-action-composition.ts` binds that worker to the immutable execution snapshot,
  canonical tool lifecycle unit of work, deferred-approval authority, and private provider ports.
- `src/app/lifecycle.ts` starts workers before both listeners, aborts active Obot exchanges during
  shutdown, closes conversation sockets, drains requests and workers, disconnects Prisma, and
  flushes telemetry.
- `prisma/schema/*.prisma` defines the product's durable domain models.
- `prisma/bootstrap/target-baseline.sql` defines a clean OpenCrane database. The baseline publisher
  installs the pinned `pg_cron` prerequisite before it switches to the application owner, then this
  file installs the pinned Absurd workflow-task schema and its control-plane queue. The server runs
  one worker for registered workflow tasks. Its focused source verifiers prove the seeded
  persona and onboarding-bootstrap content against the reviewed files in
  `docs/design/persona-archetypes/`.
- `prisma/migrations/<from>-to-<to>/` owns reviewed, adjacent schema upgrades for existing databases.
  The PostgreSQL deployment Job runs them before an incompatible server rollout; server startup
  never becomes a schema-migration authority.

## Boundary

This app owns process composition, app-specific configuration, listeners, and shutdown. Reusable
product behaviour belongs under [`libs/backend`](../../libs/backend/README.md); authentication,
transport, and external-service seams belong under
[`libs/backend/server/infra`](../../libs/backend/server/infra/README.md). Libraries never import this app.

The public and workload-facing APIs share a process but not an exposure boundary. Public ingress
routes `/api` and the public-safe `/healthz` service report only to `:8080`. That report names the
API, database, models, memory, files, channels, and optional integrations without exposing internal hosts or
failure details. Database loss returns 503; another service can report degradation while the API
remains ready to serve unaffected data. The `:8081` Service is restricted by Kubernetes NetworkPolicy, and endpoints
that grant workload authority additionally review the caller's projected Kubernetes identity and
bind it to durable assignment evidence.

### Why run admission stays in this process

Run admission is not an agent proxy and does not execute an agent session. Managed admission
synchronously combines three existing product authorities:

1. verify the managed agent service and its current signed membership evidence;
2. assemble one immutable input snapshot from the active revision and effective grants; and
3. persist the run and admission outcome in the canonical transaction.

Personal admission uses the same immutable snapshot transaction after deriving the caller's subject,
silo, participant-bound `Conversation`, and personal AgentService from trusted server authorities. Its
only browser-controlled values are its `conversationId` and retry key. One process-local capacity gate
protects the database pool and is shared by personal and managed paths, including run-now requests
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
snapshots, the `Conversation -> canonical timeline` authority, approvals, artifacts, skills,
membership, grants, provider configuration, spend, and audit evidence. An `agent_session`
conversation conditionally owns serial `AgentRun -> ordered RunEvent` streams; direct and group
messages create no run.

Database triggers protect lifecycle and proof bindings that Prisma cannot express alone. Runtime
Jobs hold attempt-scoped scratch and checkpoints; they do not replace the server's run,
conversation, approval, or artifact records.

## Runtime & config

The Helm unit supplies the database, OpenID Connect (OIDC) sign-in settings, namespaces, membership
issuer configuration (a Fleet verification key only in Fleet mode), artifact signing keys, internal
service endpoints, and listener settings. Important groups
are:

| Configuration | Purpose | Default |
| --- | --- | --- |
| `PORT` / `INTERNAL_PORT` | Public and workload-facing listeners | `8080` / `8081` |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `OPENCRANE_SILO_ID` | Silo that owns tasks admitted by this server | required |
| `OPENCRANE_WORKFLOW_*` | Absurd database pool, worker concurrency, and polling limits | small development defaults |
| `OPENCRANE_MCP_ERA_PROBE_*` | Timeout and response-size limit for remote MCP protocol checks | 5 seconds / 64 KiB |
| `OPENCRANE_OCI_REGISTRY_*` | Fixed HTTPS registry repository, request timeout, and optional Secret-backed authorization used to import admitted MCP images by digest | deployment profile / 30 seconds / no credential |
| `OIDC_*` | Organisation sign-in, callbacks, and server-side session protection | required |
| `OPENCRANE_STANDALONE_FIRST_USER_*` | Optional one-time standalone Owner admission: a configured verified email may claim the host-selected silo under its stable OIDC subject | disabled |
| `OPENCRANE_INITIAL_MODEL_*` | Optional first provider key; the server persists its custody reference and requires LiteLLM registration before readiness | disabled |
| `LITELLM_ENDPOINT`, `LITELLM_MASTER_KEY`, `MEMORY_GATEWAY_URL`, `ARTIFACT_SERVICE_URL`, `CHANNEL_PROXY_URL` | Existing private service targets used by the bounded public health report without returning their values | required when the capability is enabled |
| `OBOT_GATEWAY_URL`, `OBOT_SERVICE_TOKEN_PATH`, `OBOT_TIMEOUT_SECONDS` | Release-local credential custody and server-side external tool execution | disabled together |
| `POD_NAMESPACE` | Trusted namespace of this server and controller identity | `default` |
| `AGENT_RUNTIME_PERSONAL_NAMESPACE` | Personal runtime Job boundary | required |
| `AGENT_RUNTIME_MANAGED_NAMESPACE` | Managed runtime Job boundary | required |
| `AGENT_RUN_ADMISSION_*` | Active and queued personal-and-managed admission limits | bounded defaults |
| `OPENCRANE_MEMBERSHIP_*` | Explicit issuer model; `fleet` mounts its verifier, `standalone` starts without a Fleet key and denies run admission | required |
| `OPENCRANE_INVITATION_SIGNING_KEY_PATH`, `OPENCRANE_PUBLIC_BASE_URL`, `OPENCRANE_INVITATION_TTL_SECONDS` | Standalone invitation-link signing, public link origin, and bounded lifetime | required in standalone mode |
| `OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_*` | Fleet-owned member directory, invitations, paid-seat, and payment decisions through one silo-scoped service credential | required in Fleet mode |
| `OPENCRANE_SCHEDULER_*` | Optional scheduled-run loop and interval | disabled |
| `ARTIFACT_SERVICE_URL` and mounted artifact keys | Private byte promotion/read brokers | required when used |
| `ARTIFACT_PREPROCESSOR_*` | Restricted preprocessing worker and output ceiling | disabled |
| `CHANNEL_TARGET_*`, `CHANNEL_PROXY_SERVICE_ACCOUNT_NAME` | Exact trusted host/silo and TokenReviewed proxy caller for channel resolution | disabled when absent |
| `CHANNEL_REPLAY_RECEIVER_ID`, `CHANNEL_REPLAY_ENDPOINT` | Stable replay receiver plus exact internal endpoint; startup and the drained convergence worker reconcile distinct routes per AgentService | disabled when absent |

The app builds into `dist/apps/opencrane`, uses `deploy/Dockerfile`, and ships through its app-owned
Helm library chart, which [`deploy-k8s`](../_infra/deploy-k8s/README.md) composes into a release.

In standalone mode, successful OIDC authentication does not itself grant product access. Existing
active members proceed normally. A verified identity without membership can call only the signed
invitation-acceptance endpoint; once that transaction creates its active silo membership, the next
request proceeds without another login. Fleet mode keeps membership decisions on its configured
remote authority path.

## See also

- Parent index: [apps](../README.md)
- Composed logic: [backend capabilities](../../libs/backend/README.md) ·
  [conversation projection](../../libs/backend/conversations/projection/main/README.md) ·
  [server infrastructure](../../libs/backend/server/infra/README.md)
- Sibling apps: [opencrane-ui](../opencrane-ui/README.md) ·
  [channel-proxy](../channel-proxy/README.md) ·
  [agent-controller](../agent-controller/README.md)
