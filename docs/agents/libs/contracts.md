# Lib: contracts (`@opencrane/contracts`)

> Deep-dive for `libs/contracts`. Index: [`../app-specific.md`](../app-specific.md). Verified June 2026.

**The keystone.** Single source of truth for cross-package types and the typed opencrane-api client.
Consumed by the CLI, opencrane-server, fleet operator, frontend, and backend domain packages. Import
from the barrel only.

## What's in `src/`

- **`index.ts`** — the one barrel; re-exports everything below + the client.
- **`client.ts`** — `___CreateControlPlaneClient(baseUrl, token?)` builds an `openapi-fetch` client typed by `paths`; injects `Authorization: Bearer` when a token is given. Exports `paths`; `ControlPlaneClient` lives in `client.types.ts`.
- **`generated/api.ts`** — **auto-generated**, do not hand-edit. The `paths` type map.
- Domain type files (CRD-mirroring enums + DTOs): `cluster-tenant.types.ts` (the **ClusterTenant** customer/isolation unit), `grant.types.ts`, `group.types.ts`, `mcp-server.types.ts`, `skill-bundle.types.ts`, `third-party-source.types.ts`. The per-user **UserTenant** gateway is the `Tenant` CRD (kind still `Tenant`); for the two-concept model see [`cluster-architecture.md` → Tenancy Model](../cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).

## The type-generation pipeline

The opencrane-api emits `dist/apps/opencrane/openapi.json`; the contracts `generate` script runs
`openapi-typescript dist/apps/opencrane/openapi.json -o src/generated/api.ts`. So **the OpenAPI spec drives the client types** — after changing a
opencrane-api route's request/response shape, regenerate here rather than hand-typing. Runtime client
is `openapi-fetch` (tiny, typed `GET`/`POST`/… over `paths`).

## CRD-mirroring enums (the canonical values)

- `ClusterTenantIsolationTier`: `shared` · `dedicatedNodes` · `dedicatedCluster`
- `ClusterTenantComputeMode`: `shared` · `dedicated`
- `ClusterTenantPhase`: `pending` · `provisioning` · `ready` · `failed`
- `GrantAccess`: `allow`·`deny` · `GrantScope`: `org`·`department`·`project`·`personal` · `GrantSubjectType`: `group`·`tenant`·`user`
- `McpServerTransport`: `streamable-http`·`sse`·`websocket` · `McpServerStatus`: `active`·`degraded`·`draft` · `McpCredentialBrokeringMode`: `static`·`obo`
- `SkillBundleStatus`: `published`·`review`·`draft` · `SkillPromotionStatus`: `proposed`·`approved`·`rejected`
- `ThirdPartySourceKind`: `mcp-registry`·`anthropic-skills`·`git-repository`·`manual-upload`

These are shared by backend, CLI, and (where relevant) the frontend — never redefine them per app.
`ClusterTenantProvisionerRegistry`/`...Capability` are the webhook-provisioner seam used for the
`dedicatedCluster` tier.
