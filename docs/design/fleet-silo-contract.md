# Fleet ↔ silo contract specification

Status: **design — the one contract that survives the fleet/silo repo split (Phase 3, #150 pull-forward).**
This document specifies the single cross-repo interface between the **fleet manager** (moving OUT to the
`weownai` repo, relicensed proprietary) and the **ClusterTenant silo** (staying in `opencrane-2`, AGPL).
It moves no code and flips no licence headers — it records the decisions so the later move (#151) can happen
mechanically. The licensing rationale is [ADR 0004](../adr/0004-open-core-fleet-silo-licence-split.md).

## Why this contract exists

`opencrane-2` is becoming a standalone **ClusterTenant template**: deployable alone (single-tenant, self-hosted,
AGPL) *or* fleet-managed by an external, proprietary fleet manager. Everything the two planes share must be
expressible through a small, versioned, network/CR-level boundary — never a code link. Today the two are one
NX repo; after Phase 3 the fleet manager (`apps/fleet-operator` routes + `apps/fleet-platform` Helm chart) lives
in `weownai` and talks to the silo only through what this document specifies.

The boundary has **four surfaces** plus a **versioning discipline**:

| Surface | Direction | Medium | Today's owner |
|---|---|---|---|
| 1. `ClusterTenant` CR | fleet → silo (desired) · silo → fleet (observed) | Kubernetes cluster-scoped CRD | fleet writes `spec`, operator writes `status` |
| 2. Provisioning API | external fleet manager → fleet-manager HTTP | OpenAPI 3.1 (`/api/v1/cluster-tenants`) | `apps/fleet-operator/src/routes/cluster-tenants.ts` |
| 3. OIDC delegation payload | fleet → silo | `ClusterTenant.spec.zitadel` on the CR | `cr-bridge.ts` writes; `per-org-client.ts` reads |
| 4. Dedicated-cluster provisioner webhook | fleet → external provisioner | HTTPS webhook | `external-webhook.config.ts` (seam only) |
| 5. Versioned artifacts | opencrane-2 emits, weownai pins | `openapi.json` + `@opencrane/contracts` + CRD YAML | released per tag |

> See also: [ADR 0002 — per-ClusterTenant silo architecture](../adr/0002-per-clustertenant-silo-architecture.md)
> · [silo read-model projection](silo-readmodel-projection-design.md) (the origin of surface 3, Option A)
> · [`docs/agents/apps/fleet-operator.md`](../agents/apps/fleet-operator.md).

---

## Surface 1 — the `ClusterTenant` CR

The `ClusterTenant` custom resource is the durable, declarative boundary between the two planes. The fleet is
the system of record for **desired state** (`spec`); the silo operator is the system of record for **observed
state** (`status`). Neither writes the other's half — the CR bridge writes only `spec`
(`apps/fleet-operator/src/core/cluster-tenants/cr-bridge.ts`), the operator writes only `status`
(`apps/fleet-operator/src/cluster-tenants/internal/cluster-tenant-status-writer.ts`).

### Identity and scope

- **Group/version/kind:** `opencrane.io/v1alpha1`, `kind: ClusterTenant`, plural `clustertenants`, short name `ct`.
- **Scope:** `Cluster` (one CR per customer org; the org name is the CR name).
- **CRD source:** `apps/fleet-platform/crds/opencrane.io_clustertenants.yaml`.
- **Shared TypeScript type:** `ClusterTenant` in `libs/contracts/src/cluster-tenant.types.ts`.

### Spec (fleet-owned desired state)

Current CRD fields (`spec`), each grounded in the CRD YAML and the `ClusterTenant` contract type:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `displayName` | string (minLength 1) | yes | Human-readable customer name. |
| `vanityDomain` | string (DNS domain, ≤253) | no | Customer-vanity host CNAMEd onto the derived apex `<name>.<base>`. An **overlay**, not the org identity. |
| `isolationTier` | enum `shared \| dedicatedNodes \| dedicatedCluster` | yes (default `shared`) | Isolation strength. `dedicatedCluster` requires a registered external provisioner (surface 4). |
| `compute` | `{ mode: shared \| dedicated, nodePool? }` | no (default `shared`) | Bin-pack on shared nodes vs. pin to a dedicated pool. `nodePool` required when `mode=dedicated`. |
| `resources.quota` | `{ cpu?, memory?, pods?, storage?, gpu? }` | no | Aggregate ceiling enforced as `ResourceQuota`/`LimitRange` over the org namespace. |
| `owner` | `{ subject, email? }` | yes at create (opencrane-server-enforced, not CRD-enforced) | The org root owner's OIDC `sub` (+ IdP-verified email). The **only channel** for owner identity — the operator has no DB access and attributes the auto-seeded default `Tenant` from this field. |

**Contract gap — `spec.zitadel` (see surface 3).** The shared TypeScript type
(`ClusterTenantZitadel` in `libs/contracts/src/cluster-tenant.types.ts`), the fleet writer
(`_BuildSpecPatch` in `cr-bridge.ts`), and the silo reader (`_ResolvePerOrgClient` in
`apps/opencrane/src/infra/auth/per-org-client.ts`) **all already reference
`spec.zitadel.{clientId, orgId, redirectUri}`** — but the CRD YAML
(`opencrane.io_clustertenants.yaml`) does **not declare it**. On an API server pruning unknown fields
(the default under structural schemas), the block is silently dropped on write, so the silo reads nothing
and per-org login falls through to the masters client. **Resolved** — the CRD now declares `spec.zitadel`
(PR #157, branch `fix/clustertenant-crd-zitadel-schema`); this section documents the model that fix enables.

### Status (silo-operator-owned observed state)

| Field | Type | Meaning |
|---|---|---|
| `phase` | enum `pending \| provisioning \| ready \| failed` | Lifecycle phase the operator drove the CR to. |
| `message` | string | Human-readable detail (set on failure/transition). |
| `boundNamespace` | string | Namespace bound to the org once provisioned (`opencrane-<name>`). |
| `provisioner` | string | Identifier of the provisioner that owns the boundary. |
| `lastReconciled` | date-time | Last successful reconcile timestamp. |
| `observedGeneration` | int64 | `metadata.generation` the operator last drove to ready; the reconcile-skip guard compares this against `metadata.generation`. Must be declared in the schema or the API server prunes it, defeating the guard. |

`ClusterTenantStatus` / `ClusterTenantObservedStatus` in `libs/contracts/src/cluster-tenant.types.ts` are the
typed mirror; the fleet read path (`_ReadClusterTenantObservedStatus` → `_ObservedStatusToContract`) maps the
raw CR status into the API response, because the DB `phase` column is desired-only and never receives the
operator's write-back.

### Lifecycle

**Create.** `POST /api/v1/cluster-tenants` (surface 2) validates the request, persists the org + single
owner membership + Zitadel provisioning in one DB transaction, then projects the persisted desired state onto
a new CR via `_ApplyClusterTenantCr` with `spec.owner` mandatory (`cr-bridge.ts` `_CreateCr`; on 409 falls
back to a spec merge-patch). The operator's `ClusterTenantOperator` reconcile loop
(`apps/fleet-operator/src/cluster-tenants/operator.ts`) picks up the CR and drives
`pending → provisioning → ready`: resolve the isolation boundary, fence the `opencrane-<name>` namespace
(PSA `baseline`, `ResourceQuota`, `LimitRange`, dedicated-node scheduling), provision the per-org domain
(wildcard `Certificate` + external-dns `DNSEndpoint`, runtime-gated), then stamp `status`.

**Update.** `PUT /api/v1/cluster-tenants/:name` collects only desired-state fields (never `phase`/
`boundNamespace`/`message`/`provisioner`), persists them, and re-projects the spec via `_ApplyClusterTenantCr`
(no owner → spec merge-patch only). When `vanityDomain` actually changes on a provisioned org, the row update
and the Zitadel redirect-URI allowlist sync happen in one transaction (IdP call last) so the two never drift.
The operator re-converges to the changed spec idempotently; the reconcile-skip guard (`observedGeneration`)
prevents a no-op re-provision on watch replays.

**Teardown (align with #138).** `DELETE /api/v1/cluster-tenants/:name` deletes the DB row and tears down the
Zitadel org in one transaction (Zitadel last, 404-tolerant, so a missing IdP org still commits), then deletes
the CR via `_DeleteClusterTenantCr` **outside** the transaction (a Prisma tx cannot roll back a k8s mutation).
A CR-delete failure is logged, not 500'd — the row (source of truth) is already gone, so a retry would 404 and
never re-attempt, leaving an orphaned CR for operator cleanup. On CR delete the operator's `deprovision`
handler (`operator.ts`, DOMAIN.T2) deletes the per-org wildcard `Certificate` + `DNSEndpoint` so external-dns
reaps the DNS records; namespace GC is the backstop for everything else in the namespace.

**#138 direction to honour in the split** (from `plan.md` #138 — *ClusterTenant teardown*): teardown should
become **finalizer-driven** so the silo can complete its own deprovision (drain planes, honour the #126
dataset-retention policy) *before* the CR and namespace are reclaimed, rather than relying on best-effort
CR-delete + namespace GC racing the operator. Under the split, the finalizer is the clean handshake: the
fleet requests deletion, the silo operator runs teardown and removes its finalizer, and only then does the CR
disappear. The data-retention policy (datasets retained per #126) is a **silo-side** decision, so it must be
expressible without the fleet knowing silo internals — a teardown-policy field on the CR spec, or a silo
finalizer that consults its own policy, keeps the retention decision on the AGPL side of the boundary.

---

## Surface 2 — the provisioning API

The external fleet manager (in `weownai`) drives org lifecycle by calling the fleet-manager HTTP API. After
the split this is the **only synchronous call path** from the hosted control plane into the platform; it is
served today from `apps/fleet-operator/src/routes/cluster-tenants.ts`, mounted at `/api/v1/cluster-tenants`,
and specified in `apps/fleet-operator/src/openapi/spec.ts` → `apps/fleet-operator/openapi.json`.

| Method + path | Purpose | Auth guard | Notable codes |
|---|---|---|---|
| `GET /api/v1/cluster-tenants` | List all orgs (fleet/super-admin view). | `requireOrgManager` | — |
| `GET /api/v1/cluster-tenants/:name` | Get one org; overlays the operator's observed `status` from the CR. | `requireOrgManager` | `404 CLUSTER_TENANT_NOT_FOUND` |
| `GET /api/v1/cluster-tenants/:name/status` | Observed status only (drives the onboarding poll). | `requireOrgManager` | `404` |
| `POST /api/v1/cluster-tenants/:name/refresh` | Re-read + mirror observed status. | `requireOrgManager` | `404` |
| `POST /api/v1/cluster-tenants` | Create org (persist + Zitadel + owner membership + CR). | `_RequireBillingAccountForOrgCreate` (billing gate — a user becomes admin BY creating) | `400 VALIDATION_ERROR`, `409 CONFLICT`, `422 TIER_UNAVAILABLE` |
| `PUT /api/v1/cluster-tenants/:name` | Update desired state; re-gate tier; sync vanity redirect URIs. | `requireOrgManager` | `400`, `404`, `422 TIER_UNAVAILABLE` |
| `DELETE /api/v1/cluster-tenants/:name` | Teardown (row + Zitadel + CR). | `requireOrgManager` | `404` |

Adjacent fleet-owned surfaces that stay on the fleet side of the boundary (documented here so the split knows
what moves with the API, not what the silo depends on): `cluster-tenants/:name/members` (org membership),
`billing-accounts` (seat ordering), `platform/dns` (DNS-01 issuer + wildcard cert creds), and
`admin/zitadel-*` (per-org OIDC client provisioning + SA-key rotation). All of these are **fleet-manager
internals** — the silo never calls them. Their existence matters to the split only because they move to
`weownai` together with the routes above.

**Tier gating.** `POST`/`PUT` call `registry.isTierAvailable(tier)`
(`ClusterTenantProvisionerRegistry` in `libs/contracts`, built by
`_BuildClusterTenantProvisionerRegistry` in `apps/fleet-operator/src/core/cluster-tenants/registry.ts`) and
reject an unserviceable tier with `422 TIER_UNAVAILABLE` (`ClusterTenantTierUnavailableCode`) rather than
stranding the org in `pending`. The built-in `shared` provisioner always advertises `shared` +
`dedicatedNodes`; `dedicatedCluster` is advertised only when the external webhook (surface 4) is configured.

---

## Surface 3 — the OIDC delegation payload (the key decoupling)

This is the surface that unblocks the standalone silo (#151): **a silo must log its users in without any
direct Zitadel/IdP access.** Today the fleet manager is the sole IdP authority — on `POST /cluster-tenants`
it calls `zitadelClient.provisionOrg(...)` (`apps/fleet-operator/src/infra/zitadel/`) to create the org's
dedicated Zitadel Organization + `opencrane` project + roles + OIDC app, grant the owner `admin`, and persist
the resulting identifiers. The silo has no Zitadel credentials and must not gain any (that authority stays
proprietary, on the fleet side of the AGPL boundary — see ADR 0004).

### Zitadel tenancy model (one instance, dedicated org + project per clustertenant)

**One shared Zitadel instance** backs both planes — isolation is at the org and project level, never a
separate IdP deployment. `provisionOrg` (`apps/fleet-operator/src/infra/zitadel/zitadel-client.ts`) establishes
the following hierarchy:

| Level | Fleet plane | Each clustertenant |
|---|---|---|
| **Instance** | shared — the fleet holds the sole service-account key (instance-level rights) | the same instance |
| **Organization** | the **masters org** (single masters client; `masterSubject` lives here) | a **dedicated org** (`POST /v2/organizations`) → `orgId`, its own isolated user pool |
| **Project** | the fleet's own project | a **dedicated `opencrane` project** created inside that org (`POST /management/v1/projects`, org-scoped) → a unique `projectId`, with `owner/admin/member` roles + a `login` OIDC app |

**Invariant: every clustertenant has its own Zitadel project.** The project is created fresh inside each org,
so its `projectId` is unique per clustertenant even though the project is uniformly named `opencrane` — org
scoping isolates them. No project is ever shared between the fleet and a clustertenant, or between two
clustertenants. The master is then granted `admin` into each clustertenant's project as the cross-org SSO
bridge (a masters-org user granted into the CT org, `zitadel-client.ts`).

**Why the CR carries login ids only, not the project.** The `spec.zitadel` payload below projects
`clientId`/`orgId`/`redirectUri` — the public ids the silo's login flow needs — and deliberately omits
`projectId` and `appId`. The authorization-code flow needs the org scope + client id + redirect uri, not the
project; `projectId`/`appId` are **management** identifiers used only for role grants and redirect-uri updates,
both performed fleet-side. They are persisted in the fleet registry DB (`zitadel_project_id`, `zitadel_app_id`,
`zitadel_client_id`, `zitadel_org_id` on the `ClusterTenant` row), never on the CR. So the separate-project
invariant holds without surfacing the project on the boundary.

**Standalone-silo (#151) consequence.** A fleet-managed silo never needs `projectId` (the fleet owns project
management). A **standalone** silo has no fleet DB to read it from, so if it manages its own roles it must
provision (or be handed) its own project. Two clean options for #151, both preserving the per-clustertenant-
project invariant: the silo provisions its own dedicated `opencrane` project against its own Zitadel, or
`projectId` is added to the CR delegation payload for a silo-side management client. That choice is a #151
decision — not needed for fleet-managed login today.

### What fleet must expose

The delegation payload is the minimal set of **public** OIDC identifiers a silo needs to build a per-org login
against the org's isolated user pool. `provisionOrg` already returns them (`ZitadelProvisionOrgResult` in
`apps/fleet-operator/src/infra/zitadel/zitadel-client.types.ts`):

| Field | Source | Silo use |
|---|---|---|
| `clientId` | provisioned OIDC app's `client_id` | The per-org public credential login authorizes with. |
| `orgId` | provisioned Zitadel Organization id | Restricts login to that org's user pool via the `urn:zitadel:iam:org:id:{orgId}` scope (`_OrgScope` in `per-org-client.ts`). |
| `redirectUri` | registered callback (`<org>.<base>/api/v1/auth/callback`) | The org's canonical callback; vanity callbacks are additional allowlist entries. |

These are **public OIDC identifiers, not secrets** — a `client_id`, an org id, and a redirect URI. Carrying
them on a cluster-scoped CR is safe (the confidential SA key never leaves the fleet). The silo's OIDC
discovery URL, JWKS, token endpoint, etc. are the shared IdP metadata (one Zitadel instance base URL); the
silo resolves those from its own OIDC config — the per-org payload is only the org-scoping delta.

### The transport: CR `spec.zitadel` (design decision — Option A)

The delegation payload is delivered on the `ClusterTenant` CR `spec.zitadel` block, **not** via a fleet→silo
API call. This is Option A from the [silo read-model projection design](silo-readmodel-projection-design.md):
the fleet writes the ids onto the CR after `provisionOrg` (`_BuildSpecPatch` in `cr-bridge.ts`), and the silo
reads them straight off the CR at login (`_ResolvePerOrgClient` in
`apps/opencrane/src/infra/auth/per-org-client.ts`). Chosen over the alternatives because it:

- keeps the **CR as the single source of truth** (consistent with the desired-state pattern);
- removes the silo's `ClusterTenant` read-model table rather than adding a sync path;
- puts **no plane on the login hot path** (a fleet outage cannot block silo logins — the CR is already in etcd);
- needs **no new auth between the planes** and is unit-testable against a mocked `customApi`;
- exposes only public ids on a cluster-scoped object.

Silo login resolution, already implemented: resolve the CR for the request host (canonical first DNS label,
else exact `spec.vanityDomain` match across the cluster-scoped list), fail-closed to the masters client when
the host matches no CR or the org is not fully provisioned (`clientId`/`orgId` absent), else return
`{ clusterTenant, clientId, orgId, redirectUri }` and authorize against that org's pool.

### Standalone-silo (#151) implication

When a silo runs **without** a fleet manager, nothing writes `spec.zitadel` and the silo falls through to its
masters client — which is the correct single-tenant behaviour (one OIDC client, no per-org pools). The
contract therefore degrades cleanly: the delegation payload is **optional desired state**, present only when a
fleet manager provisioned the org. #151's standalone path is "the CR has no `zitadel` block, and that's fine";
the fleet-managed path is "the fleet stamps it." No code branch beyond the existing fail-closed fallthrough is
required once the CRD declares the field.

---

## Surface 4 — the dedicated-cluster provisioner webhook

For the `dedicatedCluster` tier (own kube-apiserver per silo — vcluster/Kamaji), provisioning is
**out-of-process** and arm's-length by design (ADR 0001/0002 call this the AGPL/WeOwnAI enterprise seam). The
fleet↔external-provisioner boundary is an HTTPS webhook, configured entirely from the environment
(`_ReadExternalWebhookConfig` in `apps/fleet-operator/src/core/cluster-tenants/external-webhook.config.ts`):

- `CLUSTER_TENANT_PROVISIONER_WEBHOOK_URL` — HTTPS endpoint (non-HTTPS fails loud at config load, so the
  bearer token is never sent in plaintext);
- `CLUSTER_TENANT_PROVISIONER_WEBHOOK_TOKEN` — bearer token (a compatibility shim; IAM-first is preferred);
- `CLUSTER_TENANT_PROVISIONER_WEBHOOK_ID` — the stable id the backend advertises in the registry (default `external`).

The generic request/result shapes are already in the contract
(`ClusterTenantProvisionRequest` / `ClusterTenantProvisionResult` in `libs/contracts/src/cluster-tenant.types.ts`):
the request carries only `{ name, isolationTier, compute, quota }` (no vendor-specific fields), and the result
returns `{ phase, message?, boundNamespace?, kubeconfigSecretRef? }` — the kubeconfig is handed back **only as
a Kubernetes Secret reference**, never as inline credential material.

**Current state to reconcile in the split.** The registry today is a pure *tier-availability gate* — the
webhook config only decides whether `dedicatedCluster` is *advertised*; the control plane no longer POSTs to
the backend itself (`registry.ts` / `registry.infra.ts` comments: "the operator owns provisioning, see
DOMAIN.T1/T2"). So `ClusterTenantProvisionRequest`/`Result` are the **published shape** for whoever does POST
to the webhook, but the live POST caller (operator vs. external orchestrator) is not yet wired. For the split
this means: the webhook shapes stay in the AGPL `@opencrane/contracts` (they are public), the *proprietary
dedicated-cluster provisioner* lives in `weownai` behind this webhook, and the seam between them is exactly
`{ url, token, id }` + the request/result DTOs. New work: decide and wire the POST caller (below).

---

## Surface 5 — versioning: how the contract is published and pinned

The split hinges on `opencrane-2` **emitting** versioned contract artifacts that `weownai` **pins** — never a
source dependency across the repo boundary. This mirrors the pattern already in place (see
[`libs/contracts/README.md`](../../libs/contracts/README.md) and MEMORY: *OpenCrane split contract* — weownai
pins two specs/clients).

**Three artifacts, one release tag.** Each tagged `opencrane-2` release emits:

1. **`apps/fleet-operator/openapi.json`** — the fleet-manager HTTP API (surface 2), authored in
   `src/openapi/spec.ts` and regenerated by `npm run emit-openapi -w @opencrane/fleet-operator`. A CI drift
   gate fails if `openapi.json` is stale, so the committed spec always matches the routes. weownai pins a
   released `openapi.json` and runs `openapi-typescript` against it to generate its own client — a clean
   process/network boundary with no AGPL linkage (the fleet-manager routes are the proprietary side, so
   weownai *owns* this API after the move; the pin pattern is what any external consumer uses today).
2. **`@opencrane/contracts`** (`libs/contracts`, version `0.1.0`) — the shared DTOs + typed client, **MIT**-
   licensed (not AGPL) precisely so proprietary consumers can link the types without inheriting AGPL. It
   carries `ClusterTenant*`, `ClusterTenantZitadel`, the provisioner registry/request/result types, and the
   generated `api.ts` + `fleet-api.ts` clients. This is the shape both planes agree on.
3. **`apps/fleet-platform/crds/opencrane.io_clustertenants.yaml`** — the CRD schema (surface 1). This is the
   authoritative wire schema for the CR; the silo (and any external fleet manager) must apply/pin the CRD
   version that declares the fields it depends on — in particular `spec.zitadel` (new work).

**Versioning discipline for the split.** The CR is `v1alpha1` today. The contract-bearing changes this
document introduces (`spec.zitadel`, teardown finalizer, webhook POST wiring) should land while both planes
are still in one repo (the #150 "pull-forward"), so the *first* cross-repo release already carries them.
After the split, any breaking change to surfaces 1–4 must bump the artifact version (CRD served version,
`@opencrane/contracts` semver, OpenAPI `info.version`) and weownai re-pins deliberately — the two repos never
share a working tree, only tagged artifacts.

---

## New work the split requires (the #151 enabler list)

Everything below is code the current tree does **not** yet expose but the contract needs. This is the concrete
hand-off list; none of it is done by this design doc.

1. **Declare `spec.zitadel` on the CRD.** ✅ **Done** (PR #157, branch `fix/clustertenant-crd-zitadel-schema`).
   `opencrane.io_clustertenants.yaml` now declares `spec.zitadel: { clientId, orgId, redirectUri }` (all
   strings, optional), with a schema regression test; without it a structural-schema API server pruned the
   block on write and per-org login silently degraded to the masters client. This was the single
   highest-priority gap for surface 3 (OIDC delegation) to work end-to-end.
2. **Finalizer-driven teardown (#138).** Move CR teardown from best-effort CR-delete + namespace-GC race to a
   silo-operator finalizer, so the silo drains its planes and honours the #126 dataset-retention policy before
   the namespace is reclaimed. Decide where the retention policy lives (a CR `spec` field vs. a silo-internal
   policy) — it must stay a silo-side decision on the AGPL boundary.
3. **Wire the dedicated-cluster webhook POST caller.** The registry is a tier-availability gate only; the
   `ClusterTenantProvisionRequest`/`Result` DTOs are published but nothing currently POSTs them. Decide the
   caller (operator vs. external orchestrator) and wire it against the `{ url, token, id }` seam, so
   `dedicatedCluster` actually provisions through the proprietary backend after the split.
4. **Confirm the artifact emit for the split.** `openapi.json` is emitted + drift-gated today; add the CRD
   YAML and (if not already) a released `@opencrane/contracts` build to the tagged-release asset set so
   weownai can pin all three from one tag.
5. **Prove standalone-silo login (#151).** ✅ **Done.** The fail-closed masters-client path is the intended
   single-tenant behaviour when no fleet manager stamps `spec.zitadel`, and it is a first-class mode, not a
   degraded one:
   - `_ResolvePerOrgClient` (`per-org-client.ts`) never calls a fleet Zitadel *management* API — it only reads
     the public `spec.zitadel` ids off the cluster-scoped CR (or the cluster API itself is absent, e.g.
     `customApi: null` in tests) and returns `null` when the block is missing/incomplete, which
     `OidcAuthService.resolveLoginClient` (`oidc.service.ts`) falls through to the masters client for.
   - The masters client itself has zero fleet dependency: it is configured entirely from `OIDC_ISSUER_URL` /
     `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` / `OIDC_SESSION_SECRET` env vars (read in
     `libs/infra/auth/src/oidc-config.ts`), which the chart already exposes as
     `clustertenantManager.oidc.{issuerUrl,clientId,redirectUri,existingSecret,clientSecret,sessionSecret}`
     in `apps/opencrane-infra/values.yaml` — a standalone operator sets these to their own,
     independently-provisioned OIDC client (Option A in `#151`'s bootstrap note) with no fleet involved.
   - First-login adoption follows the same rule: `fleetWriter` is `null` when `FLEET_INTERNAL_URL` is unset,
     and `_AdoptMemberOnLogin` (`adopt-member.ts`) then upserts `OrgMembership` locally instead of writing
     through to a fleet endpoint.
   - Test coverage: `oidc-perorg-login.test.ts` (`falls through to the masters client for an unprovisioned org
     host (fail-closed)`) and `adopt-member.test.ts` (all `fleetWriter: null` cases) already exercise this
     path together — one CR-absent + fallthrough-to-masters login, one local-only adoption.
