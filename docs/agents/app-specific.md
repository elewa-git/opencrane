# App-Specific Guidance

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

This is the per-package map. The general TypeScript rules ([`typescript.md`](./typescript.md)) and
identity rules ([`architecture.md`](./architecture.md), [`k8s.md`](./k8s.md)) apply to all of them.
Build/test a single package with `npm run build|test -w <name>` or `npx nx run <name>:build|test`. **Each package has a deep-dive doc
linked below** — read it before non-trivial work in that package. The whole-cluster picture is in
[`cluster-architecture.md`](./cluster-architecture.md).

## Apps (`apps/`)

| Package | Deep-dive | One-liner |
|---------|-----------|-----------|
| `@opencrane/server` | [apps/opencrane.md](./apps/opencrane.md) | API-first hub (**Express 5** + Prisma + K8s client). The app owns process bootstrap, configuration, route/lifecycle composition, Prisma, and its Helm unit; HTTP capabilities and reconcilers live in libraries. Listens `:8080`. |
| `@opencrane/feat-central-agents` | [apps/feat-central-agents.md](./apps/feat-central-agents.md) | Background ingestion worker (not API-first). Slack → normalise → Cognee; cursor in Postgres. `/healthz`, `/metrics`. |
| _(apps/opencrane-ui)_ | — | Org-admin Angular SPA, ported in from WeOwnAI (#152). PrimeNG, zoneless/signals, standalone components — see [`angular.md`](./angular.md). Just another client of the opencrane-api (API-First Rule below). `npx nx build\|serve opencrane-ui`. |
| `cognee`, `litellm`, `obot` | Local `README.md` | Deployment-only Nx apps under `apps/_infra/<name>`. Each owns its pinned image contract, identity, service, policy, and Helm templates; the upstream product source remains external. |
| `langfuse` | [`apps/_infra/langfuse/README.md`](../../apps/_infra/langfuse/README.md) | Pinned upstream deployment wrapper with all six bundled workload classes registered explicitly. |
| _(apps/_infra/deploy-k8s)_ | — | Silo umbrella and deploy entrypoint. It composes app-owned Helm library units and carries CRDs, issuers, external-secret wiring, and cross-plane defaults. Clean database setup is composed from the OpenCrane-owned target baseline and the PostgreSQL CNPG chart. |
| _(apps/feat-openclaw-tenant)_ | — | Deletion target: remove this OpenClaw tenant image/build rollup with its controller and renderer when the personal-agent runtime replacement lands. |
| _(apps/agent-runtime)_ | [apps/agent-runtime/README.md](../../apps/agent-runtime/README.md) | Controller-assigned one-attempt Job image. Its current Python shell opens only a projected-token-authenticated stream; no listener, model/tool driver, or durable tenant storage. |
| _(apps/agent-controller)_ | [apps/agent-controller/README.md](../../apps/agent-controller/README.md) | Thin outbound-only process and app-owned least-privilege boundary for suspended-Job assignment, fenced release, and first-Pod registration. |
| _(apps/managed-agent-runtime)_ | [apps/managed-agent-runtime/README.md](../../apps/managed-agent-runtime/README.md) | Chart/deploy-only managed (central) agent plane: dedicated namespace, connector-scoped `managed-agent-runtime-*` ServiceAccount (`automountServiceAccountToken:false`), default-deny + explicit-egress NetworkPolicies. Reuses the `agent-runtime` image; ships no source. |
| _(apps/skill-authoring)_ | [README](../../apps/skill-authoring/README.md) | Deployment-only isolated candidate-skill Job plane: restricted namespace, exact zero-RBAC identity, quota, and default-deny policy. |
| _(apps/tool-runner)_ | [README](../../apps/tool-runner/README.md) | Deployment-only isolated tenant-tool Job plane: restricted namespace, exact zero-RBAC identity, quota, and default-deny policy. |

## Libs (`libs/`)

| Package | Deep-dive | One-liner |
|---------|-----------|-----------|
| `@opencrane/contracts` | [libs/contracts.md](./libs/contracts.md) | **The keystone** — shared CRD enums/DTOs + the generated typed opencrane-api client (`___CreateControlPlaneClient`, `paths`). Import from the barrel; never redefine types per app. |
| `@opencrane/util` | [libs/util/README.md](../../libs/util/README.md) | Dependency-free pure helpers shared across domain packages (`scope:shared`). |
| `libs/server/_infra/{api,auth,http}` | — | Kubernetes, authentication, and HTTP runtime seams owned by the OpenCrane server. |
| `libs/server/_infra/channel-proxy` | — | Trusted origin/auth/rate-limit/WebSocket transport owned by the OpenCrane server runtime. |
| `libs/server/_infra/agent-runtime-stream` | [README](../../libs/server/_infra/agent-runtime-stream/README.md) | Runtime-initiated projected-token HTTP/SSE transport. It never owns assignments or durable run state. |
| `libs/backend/agents/runtime/k8s-launcher` | [README](../../libs/backend/agents/runtime/k8s-launcher/README.md) | Pure suspended-Job projection; Helm owns the dedicated runtime namespace and its network policy. |
| `libs/backend/agents/skills/k8s-launcher` | [README](../../libs/backend/agents/skills/k8s-launcher/README.md) | Pure hardened Job projection for isolated skill authoring and tool execution; the controller remains the only Kubernetes mutator. |
| `libs/backend/agents/skills/worker` | [README](../../libs/backend/agents/skills/worker/README.md) | Dependency-free Python bootstrap acknowledgement client for the governed authoring and tool-runner worker-image build. |
| `libs/backend/agents/runtime/controller` | [README](../../libs/backend/agents/runtime/controller/README.md) | Crash-safe controller orchestration: exact assignment, conditional Job release, and strict first-Pod registration. Composed only by `apps/agent-controller`. |
| `libs/server/_infra/tenant-hosting` | — | GCP and on-prem tenant-storage adapters owned by the OpenCrane server runtime; the app retains only factory composition. |
| _(libs/onboarding)_ | — | **Empty placeholder** — not registered as an NX project and has no code yet. |

## Server/control-plane domains (`libs/backend/server/<group>/<domain>/main`)

The control plane and extracted runtime capabilities are split into NX packages
(`backend-server-<d>` at `libs/backend/server/<group>/<d>/main`). The six navigational groups are
IAM (identity, membership, authorization, policies, grants, groups, access-tokens, audit), managed
agents (agent-services, skills, artifacts, channel-targets, conversation-replay), gateway governance (mcp, integrations,
providers, model-routing), knowledge (retrieval, company-docs), tenancy (tenants, cluster-tenants,
projection, contract, connections), and reporting (metrics, spend, awareness). `api-spec` remains
at `libs/backend/server/api-spec/main` because it aggregates all groups. The separate
`libs/backend/feat-openclaw-tenant/main` package remains a deletion boundary until the
personal-agent runtime replacement lands.
Each owns its routes, core services, API types, tests, and (where applicable) a
`prisma/schema/<d>.prisma` slice. Layout, bounded `scope:<capability>` rules, and the
add-a-domain checklist live in [`libs/backend/README.md`](../../libs/backend/README.md);
schema/baseline ownership in [`prisma.md`](./prisma.md).

## Personal-agent and execution domains (`libs/backend/agents/{personal,execution}/*`)

Personal-agent product capabilities use the `backend-agents-personal-<d>` NX namespace under
`libs/backend/agents/personal/<d>/main`: personas, conversations, memory, and configuration. They own a person's
approved persona, conversation events, memory catalogue, and future-snapshot configuration proposals. Shared execution capabilities use
`backend-agents-execution-<d>` under `libs/backend/agents/execution/`: `inputs/main` assembles one
immutable `RunInputSnapshot`, `runs/main` owns the run lifecycle, and `protocol` admits runtime
commands and candidate output. This grouping keeps the product state separate from the reusable
execution flow without creating a second source of persona or run truth.
Fleet membership, proof-bound authorization, and agent-service publication remain in
`libs/backend/server/` because they are control-plane authorities, not personal-agent behaviour.
A future Silo-integration custody authority belongs there too; it is not present in this checkout yet.

## Agent-runtime domains (`libs/backend/agents/runtime/*`)

Runtime packages contain the Kubernetes-specific execution support. The shared language-neutral
protocol is now `libs/backend/agents/execution/protocol`; it admits commands and candidate output
only when the current run, attempt, workload assignment, sequence, expiry, and lease fence still
match. The runtime group owns the Job launcher and controller, but no transport, model loop, tool
implementation, or second durable event store.

## Frontend libs (`libs/frontend/*`)

Angular libraries feeding `apps/opencrane-ui`, ported in from WeOwnAI (#152): `core`, `platform`
(FORK — also live in the WeOwnAI repo, kept in sync deliberately), `elements/{ui,a2ui}`,
`features/{welcome,customer-admin,tools,workspace,settings,conversation,context,notifications,metrics}`,
and `state/{core,gateways,conversation/*,assets/adapter,skills/adapter,settings/adapter,mcp/adapter,provider-key/adapter,tenant/adapter,onboarding,utils/storage}`.
Project names are `frontend-<lib>` (`scope:web` tag, may only depend on `scope:web`/`scope:shared`);
aliases are `@opencrane/*` in `tsconfig.json`, resolved via `tsconfig.frontend.json` (Angular's
module/decorator settings layered over the shared `tsconfig.json` — never edit the base config's
`module`/`moduleResolution` for Angular's sake). `state/gateways` is opencrane-ui-only here — the
fleet-only `provideFleetGateways` wiring (cluster-tenant/billing/onboarding gateways) stays in WeOwnAI,
not ported. See [`angular.md`](./angular.md) for layering/style rules.

## API-first rule

Every opencrane-api capability must be **API-first**. No opencrane-api behaviour should be
reachable only through a frontend — the OpenCrane UI, generated clients, and custom integrations
are peers over the same management API, never privileged paths.

## Nested AGENTS.md

Some subdirectories carry their own `AGENTS.md` (e.g. tenant workspace templates under
`libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/deploy/workspace/`). Those are scoped to that directory's generated
artifacts and do not override this guidance for platform source.
