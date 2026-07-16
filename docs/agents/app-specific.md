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
| `@opencrane/server` | [apps/opencrane.md](./apps/opencrane.md) | API-first hub (**Express 5** + Prisma + K8s client). Since #153 the app is **composition + reconciler wiring only** — every HTTP domain lives in `libs/backend/*` (below); the app mounts routers (`src/routes.ts`), brokers OIDC, owns the Prisma schema + reconcilers. Listens `:8080`. |
| `@opencrane/cli` | [apps/cli.md](./apps/cli.md) | The `oc` CLI — a **thin typed wrapper** over the contracts client, no business logic. OIDC device-flow login; `--output table|json`. |
| `@opencrane/feat-skill-registry` | [apps/feat-skill-registry.md](./apps/feat-skill-registry.md) | Entitlement-gated skill delivery (`:5000`). TokenReview (`aud=feat-skill-registry`) → proxy to opencrane-api; non-entitled **and** non-existent → `404` (existence-hiding). |
| `@opencrane/feat-central-agents` | [apps/feat-central-agents.md](./apps/feat-central-agents.md) | Background ingestion worker (not API-first). Slack → normalise → Cognee; cursor in Postgres. `/healthz`, `/metrics`. |
| _(apps/opencrane-ui)_ | — | Org-admin Angular SPA, ported in from WeOwnAI (#152). PrimeNG, zoneless/signals, standalone components — see [`angular.md`](./angular.md). Just another client of the opencrane-api (API-First / CLI-First Rule below). `npx nx build\|serve opencrane-ui`. |
| _(apps/opencrane-infra)_ | — | Current silo umbrella Helm chart and deploy entrypoint. Under the rewrite-freeze target it composes app-owned deployment units; it must not become the anonymous owner of independent green workloads. |
| _(apps/feat-openclaw-tenant)_ | — | Tenant-side assets / templates (not a workspace package). |

## Libs (`libs/`)

| Package | Deep-dive | One-liner |
|---------|-----------|-----------|
| `@opencrane/contracts` | [libs/contracts.md](./libs/contracts.md) | **The keystone** — shared CRD enums/DTOs + the generated typed opencrane-api client (`___CreateControlPlaneClient`, `paths`). Import from the barrel; never redefine types per app. |
| `@opencrane/util` | [libs/util/README.md](../../libs/util/README.md) | Dependency-free pure helpers shared across domain packages (`scope:shared`). |
| _(libs/onboarding)_ | — | **Empty placeholder** — not in `pnpm-workspace.yaml`, no code yet. |

## Domain packages (`libs/backend/*/main`)

The control plane's HTTP surface is split into 20 NX packages, one per functional domain
(`@opencrane/backend-<d>` at `libs/backend/<d>/main`): tenants, policies, grants, skills,
model-routing, providers, awareness, spend, groups, mcp, sessions, company-docs, audit,
access-tokens, metrics, connections, cluster-tenants, retrieval, contract, projection.
Each owns its routes, core services, API types, tests, and (where applicable) a
`prisma/schema/<d>.prisma` slice. Layout, boundary rules (`scope:backend`), and the
add-a-domain checklist live in [`libs/backend/README.md`](../../libs/backend/README.md);
schema/migration ownership in [`prisma.md`](./prisma.md).

## Frontend libs (`libs/frontend/*`)

Angular libraries feeding `apps/opencrane-ui`, ported in from WeOwnAI (#152): `core`, `platform`
(FORK — also live in the WeOwnAI repo, kept in sync deliberately), `elements/{ui,a2ui}`,
`features/{welcome,customer-admin,tools,workspace,settings,conversation,context,notifications,metrics}`,
and `state/{core,gateways,conversation/*,settings/adapter,mcp/adapter,provider-key/adapter,tenant/adapter,onboarding,utils/storage}`.
Project names are `frontend-<lib>` (`scope:web` tag, may only depend on `scope:web`/`scope:shared`);
aliases are `@opencrane/*` in `tsconfig.json`, resolved via `tsconfig.frontend.json` (Angular's
module/decorator settings layered over the shared `tsconfig.json` — never edit the base config's
`module`/`moduleResolution` for Angular's sake). `state/gateways` is opencrane-ui-only here — the
fleet-only `provideFleetGateways` wiring (cluster-tenant/billing/onboarding gateways) stays in WeOwnAI,
not ported. See [`angular.md`](./angular.md) for layering/style rules.

## API-First / CLI-First Rule

Every opencrane-api capability must be **API-first** and expose a matching `oc` CLI command in
`apps/cli`. No opencrane-api behaviour should be reachable only through a frontend — a UI is just
another client of the management API, never a privileged path.

## Nested AGENTS.md

Some subdirectories carry their own `AGENTS.md` (e.g. tenant workspace templates under
`apps/opencrane-api/src/tenants/deploy/workspace/`). Those are scoped to that directory's generated
artifacts and do not override this guidance for platform source.
