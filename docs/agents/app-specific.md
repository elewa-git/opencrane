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
| `@opencrane/fleet-operator` | [apps/fleet-operator.md](./apps/fleet-operator.md) | K8s operator — resilient watch loops reconciling Tenant/ClusterTenant/AccessPolicy CRs into namespaces, pods, NetworkPolicies, storage. Pluggable hosting adapters (GCP/on-prem). |
| `@opencrane/clustertenant-operator` | [apps/clustertenant-operator.md](./apps/clustertenant-operator.md) | API-first hub (**Express 5** + Prisma + K8s client). Since #153 the app is **composition + reconciler wiring only** — every HTTP domain lives in `libs/domain/*` (below); the app mounts routers (`src/routes.ts`), brokers OIDC, owns the Prisma schema + reconcilers. Listens `:8080`. |
| `@opencrane/cli` | [apps/cli.md](./apps/cli.md) | The `oc` CLI — a **thin typed wrapper** over the contracts client, no business logic. OIDC device-flow login; `--output table|json`. |
| `@opencrane/skill-registry` | [apps/skill-registry.md](./apps/skill-registry.md) | Entitlement-gated skill delivery (`:5000`). TokenReview (`aud=skill-registry`) → proxy to control-plane; non-entitled **and** non-existent → `404` (existence-hiding). |
| `@opencrane/harvesting-agent` | [apps/harvesting-agent.md](./apps/harvesting-agent.md) | Background ingestion worker (not API-first). Slack → normalise → Cognee; cursor in Postgres. `/healthz`, `/metrics`. |
| _(apps/tenant)_ | — | Tenant-side assets / templates (not a workspace package). |

## Libs (`libs/`)

| Package | Deep-dive | One-liner |
|---------|-----------|-----------|
| `@opencrane/contracts` | [libs/contracts.md](./libs/contracts.md) | **The keystone** — shared CRD enums/DTOs + the generated typed control-plane client (`___CreateControlPlaneClient`, `paths`). Import from the barrel; never redefine types per app. |
| `@opencrane/awareness` | [libs/awareness.md](./libs/awareness.md) | Awareness contract-version module for the control-plane rollout/canary. Org-context retrieval moved to the `@cognee/cognee-openclaw` plugin. |
| `@opencrane/util` | [libs/util/README.md](../../libs/util/README.md) | Dependency-free pure helpers shared across domain packages (`scope:shared`). |
| _(libs/onboarding)_ | — | **Empty placeholder** — not in `pnpm-workspace.yaml`, no code yet. |

## Domain packages (`libs/domain/*/main`)

The control plane's HTTP surface is split into 20 NX packages, one per functional domain
(`@opencrane/domain-<d>` at `libs/domain/<d>/main`): tenants, policies, grants, skills,
model-routing, providers, awareness, spend, groups, mcp, sessions, org-culture-propagation, audit,
access-tokens, metrics, connections, cluster-tenants, retrieval, contract, projection.
Each owns its routes, core services, API types, tests, and (where applicable) a
`prisma/schema/<d>.prisma` slice. Layout, boundary rules (`scope:domain`), and the
add-a-domain checklist live in [`libs/domain/README.md`](../../libs/domain/README.md);
schema/migration ownership in [`prisma.md`](./prisma.md).

## API-First / CLI-First Rule

Every control-plane capability must be **API-first** and expose a matching `oc` CLI command in
`apps/cli`. No control-plane behaviour should be reachable only through a frontend — a UI is just
another client of the management API, never a privileged path.

## Nested AGENTS.md

Some subdirectories carry their own `AGENTS.md` (e.g. tenant workspace templates under
`apps/clustertenant-operator/src/tenants/deploy/workspace/`). Those are scoped to that directory's generated
artifacts and do not override this guidance for platform source.
