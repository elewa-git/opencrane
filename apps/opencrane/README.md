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
 signed-in UI                                cluster workloads
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
                   KurrentDB HistoryStore
```

**In this flow:** [opencrane-ui](../opencrane-ui/README.md) ·
[agent-controller](../agent-controller/README.md) ·
[conversation-computer](../conversation-computer/README.md) ·
[backend capabilities](../../libs/backend/README.md)

Startup proceeds in five visible stages:

1. initialise telemetry before any instrumented dependency loads;
2. freeze process configuration and construct Prisma and Kubernetes clients;
3. register the Absurd-owned conversation-turn workflow with the bounded personal run-admission
   port, then start activation only after the handler exists. Admission rechecks Kurrent identity,
   lease and message history plus every immutable compiler input;
4. build the public and internal Express applications; and
5. start the workflow runtime and bounded background workers, then open both listeners under one
   coordinated shutdown path. Signed-in conversation updates use the public SSE route.

The route registry is deliberately a catalogue rather than a second application layer:

| Listener | Area | What is mounted |
| --- | --- | --- |
| Public `:8080` | Identity and access | audit, groups, grants, resource shares |
| Public `:8080` | Agents | agent-service management and governed skill catalogue |
| Public `:8080` | Personal workspace | guided onboarding, assets, persona, approvals, runs, configuration, conversations |
| Public `:8080` | Gateways | MCP catalogue and durable tool tasks, OCI image promotion, model routing, providers, bring-your-own-key, model registry |
| Public `:8080` | Knowledge and reporting | retrieval sources, budgets, token usage |
| Internal `:8081` | Controller | run-attempt, workflow-owned skill-authoring validation, and OCI MCP Job dispatch |
| Internal `:8081` | Runtime | one-use bootstrap, command stream, candidate ingest, skill-authoring exchange |
| Internal `:8081` | Workers and replay | Pod-bound MCP command/result exchange, artifact preprocessing, controller-selected conversation replay, and the lease-fenced computer review credential |

The invariant is simple: a request creates or changes durable product state before a worker is
trusted to act. Runtime input is frozen for the accepted attempt, and events are recorded in order
before clients receive them. Missing or mismatched identity, assignment, authorization, or ordering
evidence produces a refusal, never partial authority.

Conversation routes compose the server-owned KurrentDB history and private-payload authorities.
They expose authenticated history reads, message submission and
`GET /api/v1/me/conversations/:conversationId/events` on the existing public listener. The event
route uses bounded SSE frames and exclusive KurrentDB revision cursors; it rechecks current
participant access and join visibility before releasing private content. Disconnect and shutdown
cancel stream work. This app keeps session, Prisma projection and listener ownership; no channel
proxy workload or routing registry is involved.

## Public surface

`Entrypoint: src/index.ts` starts telemetry first, freezes configuration, composes the functional
libraries, and hands their resources to the process lifecycle.

All other production source lives in `src/bootstrap/`:

| Source | Responsibility |
| --- | --- |
| `configuration/` | Read and type deployment configuration once. |
| `http/` | Assemble authenticated public and workload-facing routers. |
| `conversations/` | Connect conversation history and computer lifecycle; register the durable turn workflow and mount its review credential route. |
| `workflows/` | Compose MCP transport and declare workflow tasks. |
| `process/` | Initialise telemetry and clients, then start, drain, and close resources. |

The [conversation library](../../libs/backend/server/conversations/main/README.md) owns admission and
compile-before-commit orchestration. [Onboarding](../../libs/backend/server/agents/onboarding/main/README.md)
and [personas](../../libs/backend/agents/personal/personas/main/README.md) own their publication adapters.
[Artifacts](../../libs/backend/server/agents/artifacts/main/README.md) owns lease signing, service
transport and preprocessing brokers; [conversation assets](../../libs/backend/server/conversation-assets/main/README.md)
owns its participant-file broker. [HTTP infrastructure](../../libs/backend/server/infra/http/README.md)
owns health probes and request-log sanitisation, and [history-store infrastructure](../../libs/backend/server/infra/history-store/README.md)
owns authenticated connections and the silo guard.

`prisma/schema/` defines persisted product state. `prisma/bootstrap/target-baseline.sql` is the clean
installation authority; startup does not modify the schema. Container, Helm and database-generation
metadata stay with this deployable.

## Boundary

This app owns process composition, app-specific configuration, listeners, and shutdown. Reusable
product behaviour belongs under [`libs/backend`](../../libs/backend/README.md); authentication,
transport, and external-service seams belong under
[`libs/backend/server/infra`](../../libs/backend/server/infra/README.md). Libraries never import this app.

The public and workload-facing APIs share a process but not an exposure boundary. Public ingress
routes `/api` and the public-safe `/healthz` service report only to `:8080`. That report names the
API, database, models, memory, files, and optional integrations without exposing internal hosts or
failure details. Database loss returns 503; another service can report degradation while the API
remains ready to serve unaffected data. The `:8081` Service is restricted by Kubernetes NetworkPolicy, and endpoints
that grant workload authority additionally review the caller's projected Kubernetes identity and
bind it to durable assignment evidence.

The server chart owns the server's network boundary. The
[Agent Sandbox chart](../_infra/agent-sandbox/README.md) owns computer ingress and egress, and the
[LiteLLM chart](../_infra/litellm/README.md) admits this server and Cognee at the model service.
Conversation-computer Pods have no direct model-service path.

### Run admission boundary

Run admission is not an agent proxy and does not execute an agent session. Personal
ConversationComputer admission synchronously combines three existing product authorities:

1. verify the personal agent service, proxied identity, active computer lease, and current deployment-selected human membership evidence;
2. assemble one immutable input snapshot from the active revision and effective grants; and
3. persist the run and admission outcome in the canonical transaction.

The reusable authorities live in
[`execution/runs`](../../libs/backend/agents/execution/runs/main/README.md) and
[`execution/inputs`](../../libs/backend/agents/execution/inputs/main/README.md). The conversation library owns the admission capacity gate and composes Kurrent-backed execution-subject,
conversation-context, and encrypted prompt-message authorities. The app supplies process configuration
and the shared history client. The production compiler repository resolves persona
instructions, tools, artifacts, skills, and the model route through a transaction-bound Prisma read
snapshot and refuses any missing or mismatched immutable reference. Personal ConversationComputer
admission is mounted; managed run-now and scheduler paths remain absent by design.

Personal run status is mounted for signed-in owners.

When the app composes admission, moving it into another deployable would add a network and availability boundary without
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
snapshots, conversation projections and policy, approvals, artifacts, skills, membership, grants,
provider configuration, spend, and audit evidence. KurrentDB owns the canonical conversation
timeline. An `agent_session` conversation conditionally owns serial `AgentRun -> ordered RunEvent`
streams; direct and group messages create no run.

Database triggers protect lifecycle and proof bindings that Prisma cannot express alone. KurrentDB
holds canonical conversation and computer lifecycle evidence; Agent Sandbox realizes only the
currently admitted computer generation.

## Runtime & config

The Helm unit supplies the database, OpenID Connect (OIDC) sign-in settings, namespaces, membership
issuer configuration (a Fleet verification key only in Fleet mode), artifact signing keys, internal
service endpoints, and listener settings. Important groups
are:

| Configuration | Purpose | Default |
| --- | --- | --- |
| `PORT` / `INTERNAL_PORT` | Public and workload-facing listeners | `8080` / `8081` |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `OPENCRANE_HISTORY_STORE_*` | TLS-only KurrentDB endpoint plus read-only CA, username, and password mounts used for checked event history | required |
| `OPENCRANE_SILO_ID` | Silo that owns tasks admitted by this server | required |
| `OPENCRANE_WORKFLOW_*` | Absurd database pool, worker concurrency, and polling limits | small development defaults |
| `OPENCRANE_MCP_ERA_PROBE_*` | Timeout and response-size limit for remote MCP protocol checks | 5 seconds / 64 KiB |
| `OPENCRANE_OCI_REGISTRY_*` | Fixed HTTPS registry repository, request timeout, and optional Secret-backed authorization used to import admitted MCP images by digest | deployment profile / 30 seconds / no credential |
| `OIDC_*` | Organisation sign-in, callbacks, and server-side session protection | required |
| `OPENCRANE_STANDALONE_FIRST_USER_*` | Optional one-time standalone Owner admission: a configured verified email may claim the host-selected silo under its stable OIDC subject | disabled |
| `LITELLM_ENDPOINT`, `LITELLM_MASTER_KEY`, `MEMORY_GATEWAY_URL`, `ARTIFACT_SERVICE_URL` | Existing private service targets used by the bounded public health report without returning their values | required when the capability is enabled |
| `POD_NAMESPACE` | Trusted namespace of this server and controller identity | `default` |
| `AGENT_RUN_ADMISSION_*` | Active and queued personal-conversation admission limits | bounded defaults |
| `OPENCRANE_MEMBERSHIP_*` | Explicit issuer model; `fleet` mounts its verifier, `standalone` reads current local membership using the deployment silo and OIDC issuer | required |
| `OPENCRANE_INVITATION_SIGNING_KEY_PATH`, `OPENCRANE_PUBLIC_BASE_URL`, `OPENCRANE_INVITATION_TTL_SECONDS` | Standalone invitation-link signing, public link origin, and bounded lifetime | required in standalone mode |
| `OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_*` | Fleet-owned member directory, invitations, paid-seat, and payment decisions through one silo-scoped service credential | required in Fleet mode |
| `ARTIFACT_SERVICE_URL` and mounted artifact keys | Private byte promotion/read brokers | required when used |
| `ARTIFACT_PREPROCESSOR_*` | Restricted preprocessing worker and output ceiling | disabled |

The app builds into `dist/apps/opencrane`, uses `deploy/Dockerfile`, and ships through its app-owned
Helm library chart, which [`deploy-k8s`](../_infra/deploy-k8s/README.md) composes into a release.
The bundle keeps npm packages external, so this app's production dependencies must include its
runtime clients, including KurrentDB. A dependency declared only at the workspace root is absent
from the production image's workspace-scoped install.
The history client verifies the mounted CA and supplies its mounted service credential through
the SDK credential provider. Passwords stay out of the connection URL: the native transport
otherwise preserves percent-encoded password characters and rejects valid generated credentials.

### Conversation-computer activation consumer

Every server replica joins the silo's `conversation-computer-activation` KurrentDB consumer group as
a competing consumer, so `clustertenantManager.replicas` can be raised and a rolling restart never
leaves activations unread. Operator notes:

- The group is created once by the KurrentDB bootstrap Job with
  `historyStore.kurrentdb.activationSubscription.maxSubscriberCount` (default `4`) and the
  `RoundRobin` strategy. Keep the count at or above the server replica count plus one for the extra
  Pod a rolling update adds. The bootstrap Job does not update an existing group, so a change needs a
  fresh silo. `Pinned` is not an option here: it hashes on the source stream, which for one activation
  stream would send everything to a single consumer.
- Two replicas may handle the same computer at once. That is safe without a lock: every history write
  carries an expected revision and a deterministic event id, the SandboxClaim name is derived from the
  computer and generation, and the PostgreSQL lease projection only accepts an identical row. The
  loser of a race gets a revision conflict, retries the delivery, and then observes the finished
  activation as an idempotent replay.
- A `stop` delivery reloads its exact human causation entry and admits one requester-bound cancellation
  task. It acknowledges durable admission without starting replacement work. Final output and Stop
  contend on the same turn-stream revision, so only one can publish the turn's terminal outcome.
  `npm exec -- nx run opencrane:test:stop-sql` exercises the saved authority and cleanup against a
  disposable `DATABASE_URL`; the target uses UTC so fixture timestamps match database timestamps.
- A dropped or ended subscription is logged at `warn` and reopened with jittered backoff (1 s doubling
  to 30 s). After 20 consecutive drops without a healthy session (roughly eight minutes of a KurrentDB
  outage) the consumer logs `fatal` with `conversation computer activation consumer gave up`, sends
  the process SIGTERM, and shutdown exits non-zero so Kubernetes restarts only that replica. A session
  that delivered an event or stayed open for 60 s resets the drop count.
- On SIGTERM the consumer stops pulling deliveries, lets the delivery it holds finish or hands it back
  to the group with a retry nack, then closes the subscription. Deliveries KurrentDB had buffered for
  that replica are redelivered to the remaining replicas after the group's 60 s message timeout.

In standalone mode, successful OIDC authentication does not itself grant product access. Existing
active members proceed normally. A verified identity without membership can call only the signed
invitation-acceptance endpoint; once that transaction creates its active silo membership, the next
request proceeds without another login. Fleet mode keeps membership decisions on its configured
remote authority path.

## See also

- Parent index: [apps](../README.md)
- Composed logic: [backend capabilities](../../libs/backend/README.md) ·
  [conversation authority](../../libs/backend/server/conversations/main/README.md) ·
  [server infrastructure](../../libs/backend/server/infra/README.md)
- Sibling apps: [opencrane-ui](../opencrane-ui/README.md) ·
  [agent-controller](../agent-controller/README.md)
