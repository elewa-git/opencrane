# Brief: MCP + Skills Platform via Config-Slaved Ingress Planes

> Implementation brief for a coding agent. Scoped and imperative. All code must follow `AGENTS.md` (bracket placement, `*.types.ts` separation, JSDoc, import order, gitmoji commits) and the IAM-first policy.

## Goal

Replace the policy-only "MCP Server Plane" and the shared-PVC skill mount with **two config-slaved ingress service planes**, both governed by a single opencrane-server authority:

- **Obot MCP Gateway** — in-cluster MCP registry + gateway (runtime tool broker).
- **Skill Registry & Delivery** — our org-aligned ClawHub alternative for skills management & sharing (content registry + scoped delivery).

The control plane is the sole authority for both planes' configuration *and* per-tenant grants. Tenants reach both planes only via short-lived, audience-bound Workload Identity. IAM-first throughout.

## Architecture (authority + two planes)

```
            ┌──────────────── Control Plane (sole authority) ────────────────┐
            │  5-level permission compiler · effective-contract API ·         │
            │  config authority for BOTH planes · absorbed admin UI           │
            └───────┬───────────────────────────────────────┬─────────────────┘
                (0) config / (1) grants               (0) config / (1) grants
                    ▼                                       ▼
   ┌────────────────────────────┐           ┌────────────────────────────────────┐
   │ Obot MCP Gateway (ingress) │           │ Skill Registry & Delivery (ingress)  │
   │ - runtime broker, per-call │           │ - content pull over OCI/ORAS         │
   │   authz                    │           │ - per-read entitlement enforcement   │
   │ - holds downstream secrets │           │ - serves only entitled digests       │
   │ - native admin disabled    │           │ - config-slaved, no standalone admin │
   └─────────────▲──────────────┘           └──────────────────▲───────────────────┘
        (3) projected JWT                          (3) projected JWT
        aud=obot-gateway                           aud=feat-skill-registry
                 └──────────────  tenant pods (claws)  ────────┘
```

Full cluster context lives in `README.md`; this brief covers the two service planes and their control path.

## Non-negotiable invariants

1. **Control plane is the only authority.** Neither plane holds authoritative config. Native admin UIs/APIs are disabled; both are operator-reconciled and drift-detected (reuse `libs/backend/projection/main/src/routes/internal/projection-drift.ts` pattern).
2. **Tenant→plane auth = projected ServiceAccount token**, audience-bound (`aud=obot-gateway` / `aud=feat-skill-registry`), ~600s TTL, kubelet-rotated. **Delete** the predictable `OPENCLAW_GATEWAY_TOKEN` (`apps/fleet-operator/src/tenants/deploy/3-deployment.ts:36`).
3. **The serving plane is the live authority; the pod contract is advisory** and can never widen access.
4. **Authorization is group-based, not tier-based.** The compiler knows only principals, groups, and grants (deny-wins → priority); the control plane owns the org→group mapping, sync, and nesting. Tiers are a UI affordance only. See *Authorization model* below — this is canonical.
5. **MCP downstream secrets live only in Obot**, injected server-side via the shim; never reach a pod.
6. **MCP servers and skill bundles run/originate in-cluster**; no remote calls. Tenants reach only the plane ingress, never the backing stores (Obot DB, OCI registry).
7. **Two clocks:** revocation is effective on the next gateway call / next pull (fail-closed); newly granted capabilities become usable once the pod re-pulls the contract (eventually-consistent).
8. **ClawdBot config** BOOTSTRAP.MD, SOUL.MD and other briefs are designed and injected at create time to ensure the ClawdBot is aware of it's role within the organisation and works as intended. ClawdBot on bootstrap explains to the user how OpenCrane works (explained to a toddler in a professional way!).
9. **No legacy. No backwards compatibility.** Remove every superseded path as you build the replacement — the predictable `OPENCLAW_GATEWAY_TOKEN`, the shared-skills PVC + `entrypoint.sh` symlink, the filesystem-only `skillsRouter`, the CSV MCP allow/deny enforcement, and any dual-write or failover branch. The platform is pre-production (`AGENTS.md` Delivery Direction): ship one clean target architecture, **not** a migration layer. Do **not** add compatibility shims, feature flags for old paths, or parallel code branches "just in case". Delete, don't deprecate.

## Authorization model (canonical — groups, not tiers)

**The compiler is tier-agnostic.** It knows only **principals, groups, and grants** — it has no concept of "department", "team", or "project". Org structure is an opencrane-server concern. This is deliberate: a fixed scope-tier enum would be baked into the compiler, CRDs, the versioned contract, the DB, and the UI, so adding or changing a level later would mean a migration across all of them **plus a fleet contract-version rollout**. Groups make the level set free to evolve with zero compiler/contract change. **Do not introduce a scope-tier enum anywhere downstream.**

**Primitives:**

- `Group` — a named set of principals **or** an explicit list of individuals: `{ id, name, kind (named | individual-list), members[] (tenant/principal refs), source (manual | idp | scim | tier-derived), createdAt, syncedAt }`. A direct-to-tenant share is just a group of one.
- `Grant` — attaches a payload to a group: `{ id, targetGroupId, effect (allow | deny), priority (int), payload (mcpServerId | skillBundleId+digest), grantedBy, createdAt }`.

**Resolution (the only precedence rule the compiler knows):**

1. Collect all grants whose `targetGroup` contains the principal.
2. **deny-wins** — any matching `deny` removes the payload, regardless of priority.
3. Otherwise the **highest `priority`** allow wins (this is what resolves *which skill version/digest* applies).
4. Deterministic tiebreak (newest `createdAt`) when priorities tie.

The compiler never interprets what a group *means*.

**Control-plane responsibilities (where the org model lives):**

- **Own + sync group membership** from IdP / SCIM / org structure / manual edits, kept current.
- **Flatten nested groups** (e.g. "department = union of its teams") into flat principal sets *before* the compiler sees them — the compiler does no graph traversal.
- **Tier → group + priority mapping.** The familiar tiers (org / department / team / project / personal) are a **UI affordance only**: the control plane seeds one group per tier instance and assigns each a default `priority` (personal high → org low). Tiers exist in the UI and in the tier→group mapping — **nowhere downstream**.
- **Membership change → recompile → push.** A membership change recomputes affected principals' grants and rides the existing live-grant clock (push to gateway; tenant re-pulls contract).

**Reconcile existing data:** the current dataset-membership vocabulary (`org/team/project/personal`) becomes seed groups under this model. Reconcile it to groups — do **not** keep it as a parallel scope enum.

## Components & responsibilities

- **Control plane** (`apps/opencrane`): MCP + skill registry CRUD, permission compiler, versioned effective-contract endpoint, config authority for both planes, promotion/demotion workflow. Absorbs both admin UIs.
- **Operator** (`apps/fleet-operator`): reconciles both planes' config + registries into the cluster; injects projected token + contract into tenant pods; drift-detects/repairs.
- **Obot MCP Gateway** (headless, in-cluster): validates projected JWT, per-call scope check, brokers downstream creds via RFC 8693 shim.
- **Skill Registry & Delivery** (in-cluster ingress): scoped content delivery over OCI/ORAS; entitlement enforced per read.
- **Tenant pod / claw** (`apps/feat-openclaw-tenant`): presents projected token; re-pulls contract at agentic-loop boundaries; pulls only entitled skill digests; holds no downstream secret.

## Data flows

- **(0) config** — control plane → operator → plane: registries, IdP binding, gateway/auth, lifecycle. Drift-repaired.
- **(1) grants** — control plane → plane: per-tenant compiled scope, pushed live.
- **(2) contract** — opencrane-server effective-contract endpoint → pod: versioned, pulled at loop boundaries.
- **(3) JWT** — pod → plane: short-lived, audience-bound identity.

## Skill registry & delivery (build thin, reuse the rest)

Build our own registry, but stand it on existing substrate — do **not** rebuild a blob store:

- **Reuse — storage + immutable digests:** The Zot OCI registry via **ORAS**. This realises the plan's "OCI digest-pinned bundles."
- **Reuse — scanning:** Trivy/Grype on ingest.
- **Reuse — discovery search:** Cognee dataset (no second vector index).
- **Build (thin, ours in control plane):** scope tagging; promotion/demotion workflow (opencrane-server-gated ingest, incl. mirroring curated bundles from upstream ClawHub / `anthropics/skills`); entitlement resolution (shared compiler); the delivery endpoint. 

`SKILL.md` is the cross-vendor open standard (Anthropic + OpenAI, Dec 2025) — existing `skills/shared/**` files already conform.

### Discovery & delivery

- The **effective-contract carries the entitled skill index** as cheap metadata: `{ name, description, scope, digest }`. This is the agent's discovery index (progressive disclosure) — bodies are lazy-pulled on first selection.
- OpenClaw discovers skills by scanning `$STATE_DIR/agents/main/skills`. Replace the shared-PVC symlink (`apps/feat-openclaw-tenant/deploy/entrypoint.sh:144`, mount at `apps/fleet-operator/src/tenants/deploy/3-deployment.ts:82`) with per-tenant entitled pulls into that dir. Keep a pull-through cache for cold-start.
- At each loop boundary: re-pull contract → diff entitled set → pull new bodies, drop de-entitled → refresh the `{name, description}` index.

### Entitlement-scoping (security-critical)

The registry — not the contract — is the boundary. The pod can reach the ingress and is untrusted (prompt-injection), so enforce on **every read**, treating the verified `sub` as a mandatory filter:

- **Split the surface by audience:** the pod-facing delivery endpoint supports *only* scoped `get-by-entitled-digest` — **no list/search verb**. Catalog/search is reachable only by the opencrane-server / human UI.
- **Content-addressable pull is still entitlement-checked:** knowing a digest must not grant the blob.
- **Existence-hiding:** non-entitled lookups return `404`/empty, not `403`.
- **NetworkPolicy:** pods reach only the delivery ingress, never the backing OCI store.
- **Never trust the pod to self-limit;** audit every out-of-scope attempt into the existing audit trail.

## Control-plane extensions for MCP & skill management

The existing control plane (`apps/opencrane`) needs three new domain surfaces: **MCP server management**, **skill catalog & sharing**, and **third-party source installation**. Each surface follows the same pattern — the control plane is the sole authority; the planes are config-slaved consumers.

### MCP server management

Extend the control plane to own the full lifecycle of MCP servers available to the organisation.

**Data model** (Prisma, new models):

- `McpServer` — canonical registry entry: `{ id, name, description, transport (stdio | sse | streamable-http), image?, url?, envSchema, configSchema, tags[], sourceRef?, createdAt, updatedAt }`.
- `McpServerGrant` — an instance of the canonical `Grant`: `{ mcpServerId, targetGroupId, effect (allow | deny), priority, grantedBy, createdAt }`. The group-based compiler rolls these into the effective set (deny-wins → priority).
- `McpServerCredential` — pointer to the Obot token store entry (never stored in the opencrane-server DB directly): `{ mcpServerId, obotCredentialRef, rotatedAt }`.

**Routes** (`libs/backend/mcp/main/src/routes/mcp-servers.ts`):

| Verb | Path | Purpose |
|------|------|---------|
| `GET` | `/api/mcp-servers` | List all registered MCP servers (admin catalog) |
| `POST` | `/api/mcp-servers` | Register a new MCP server (manual or from third-party source) |
| `GET` | `/api/mcp-servers/:id` | Server detail + current grant summary |
| `PATCH` | `/api/mcp-servers/:id` | Update config / description / tags |
| `DELETE` | `/api/mcp-servers/:id` | Deregister; cascades revocation to all tenants |
| `POST` | `/api/mcp-servers/:id/grants` | Grant server access to a scope/subject |
| `DELETE` | `/api/mcp-servers/:id/grants/:grantId` | Revoke a specific grant |
| `POST` | `/api/mcp-servers/:id/credentials` | Store downstream credential via Obot shim |
| `GET` | `/api/mcp-servers/:id/test` | Dry-run connectivity check (control plane → in-cluster server) |

On every write, the control plane pushes updated config + grants to the Obot MCP Gateway via the operator reconcile path (flow 0 + 1).

### Skill catalog, sharing & promotion

Build a registry-backed catalog that supports authoring, group-scoped sharing, and promotion/demotion across groups (see *Authorization model*). The filesystem-only router is **deleted**, not kept alongside.

**Data model** (Prisma, extend existing `Skill` model):

- `SkillBundle` — immutable content record: `{ id, name, version (SemVer), description, author, authorGroupId, digest (OCI SHA256), contentSize, tags[], sourceRef?, scanStatus (pending | clean | flagged), promotedFrom?, createdAt }`.
- `SkillEntitlement` — an instance of the canonical `Grant` (mirrors `McpServerGrant`): `{ skillBundleId, targetGroupId, effect (allow | deny), priority, grantedBy, createdAt }`.
- `SkillPromotion` — audit trail for promotion/demotion: `{ id, skillBundleId, fromGroupId, toGroupId, promotedBy, reviewedBy?, decision (pending | approved | rejected), decidedAt? }`.

**Routes** (`libs/backend/skills/main/src/routes/skill-catalog.ts`):

| Verb | Path | Purpose |
|------|------|---------|
| `GET` | `/api/skills/catalog` | Search/browse skill catalog (scoped to caller's visibility) |
| `GET` | `/api/skills/catalog/:id` | Skill detail + content preview + entitlement summary |
| `POST` | `/api/skills/catalog` | Ingest a new skill bundle (upload `SKILL.md` + assets) |
| `PATCH` | `/api/skills/catalog/:id` | Update metadata / tags (content is immutable — new version) |
| `DELETE` | `/api/skills/catalog/:id` | Soft-delete; cascades entitlement revocation |
| `POST` | `/api/skills/catalog/:id/versions` | Publish a new version (creates new immutable digest) |
| `POST` | `/api/skills/catalog/:id/entitlements` | Grant skill access to a scope/subject |
| `DELETE` | `/api/skills/catalog/:id/entitlements/:eid` | Revoke entitlement |
| `POST` | `/api/skills/catalog/:id/promote` | Request promotion to a wider scope (triggers review) |
| `POST` | `/api/skills/catalog/:id/demote` | Demote to a narrower scope |
| `GET` | `/api/skills/search` | Cognee-backed semantic search across entitled catalog |

**Sharing workflow:**

1. A tenant or team author creates a skill at their scope (e.g. `team:engineering`).
2. The skill is ingested into OCI/ORAS (Zot), scanned (Trivy/Grype), and registered in the catalog.
3. The author requests promotion to a wider scope (e.g. `org`). The control plane creates a `SkillPromotion` record.
4. An admin reviews and approves/rejects. On approval, the compiler re-evaluates entitlements for all affected tenants.
5. Entitled tenants pick up the new skill at the next contract re-pull.

### Third-party MCP & skill installation

Support installing MCP servers and skills from external registries and curated upstream sources. The control plane acts as a gatekeeper — nothing reaches the cluster without passing through the ingest pipeline.

**Supported third-party sources:**

| Source | Type | Ingest method |
|--------|------|---------------|
| [MCP Server Registry](https://github.com/modelcontextprotocol/servers) | MCP servers | Mirror manifest; pull container images into in-cluster registry |
| [Anthropic skills](https://github.com/anthropics/skills) | Skills | Mirror `SKILL.md` bundles into OCI/ORAS via ORAS push |
| ClawHub (future) | Skills + MCPs | OCI pull from upstream registry |
| Custom URL / Git repo | Either | Clone + ingest pipeline |
| Manual upload | Either | Direct upload via opencrane-ui / opencrane-server |

**Third-party source data model** (Prisma):

- `ThirdPartySource` — upstream registry pointer: `{ id, name, type (mcp-registry | feat-skill-registry | git-repo | oci-registry), url, syncSchedule (cron), lastSyncAt?, authSecretRef?, enabled, createdAt, updatedAt }`.
- `ThirdPartySourceItem` — tracked upstream item: `{ id, sourceId, externalId, name, description, latestVersion, localRef? (McpServer.id or SkillBundle.id), syncStatus (available | installed | outdated | removed), lastCheckedAt }`.

**Routes** (`libs/backend/retrieval/main/src/routes/third-party-sources.ts`):

| Verb | Path | Purpose |
|------|------|---------|
| `GET` | `/api/third-party-sources` | List configured upstream sources |
| `POST` | `/api/third-party-sources` | Add a new upstream source |
| `PATCH` | `/api/third-party-sources/:id` | Update sync schedule / auth / enable-disable |
| `DELETE` | `/api/third-party-sources/:id` | Remove source (does not uninstall already-installed items) |
| `POST` | `/api/third-party-sources/:id/sync` | Trigger manual sync (discover available items) |
| `GET` | `/api/third-party-sources/:id/items` | Browse available items from this source |
| `POST` | `/api/third-party-sources/:id/items/:itemId/install` | Install an item into the local MCP/skill registry |
| `POST` | `/api/third-party-sources/:id/items/:itemId/update` | Pull latest version for an already-installed item |
| `DELETE` | `/api/third-party-sources/:id/items/:itemId/uninstall` | Uninstall (deregister + revoke entitlements) |

**Ingest pipeline (security-critical):**

1. **Fetch** — pull manifest / `SKILL.md` / container image from the upstream source.
2. **Scan** — Trivy/Grype vulnerability scan. Flagged items are quarantined, not installable.
3. **Validate** — schema validation (`SKILL.md` structure for skills; transport/config schema for MCP servers).
4. **Register** — create the local `McpServer` or `SkillBundle` record. For MCP servers, push config to Obot via operator reconcile. For skills, push content to OCI/ORAS (Zot).
5. **Entitle** — the item starts with no grants. An admin must explicitly assign scope before any tenant can use it.
6. **Audit** — every install/update/uninstall is logged to the existing audit trail.

**Auto-sync:** configured sources are synced on their `syncSchedule` by a platform background agent (CronJob with its own Workload Identity). The sync only discovers and updates `ThirdPartySourceItem` records — it never auto-installs. Installation is always an explicit admin action.

### Effective-contract integration

Both MCP servers and skills flow into the tenant's effective contract via the shared group-based compiler:

```json
{
  "contractVersion": "2.1.0",
  "mcp": {
    "gateway": "http://obot-gateway.opencrane-system.svc:8080",
    "servers": [
      { "name": "github", "transport": "sse", "scopes": ["repo:read", "issues:write"] },
      { "name": "slack",  "transport": "stdio", "scopes": ["channels:read"] }
    ]
  },
  "skills": {
    "registry": "http://feat-skill-registry.opencrane-system.svc:5000",
    "entitled": [
      { "name": "company-policy", "grantedVia": "group:all-staff",   "version": "1.0.0", "digest": "sha256:abc123..." },
      { "name": "team-playbook",  "grantedVia": "group:engineering", "version": "2.1.0", "digest": "sha256:def456..." }
    ]
  }
}
```

The `GET /api/tenants/:name/effective-contract` endpoint compiles this by evaluating all `McpServerGrant` and `SkillEntitlement` grants whose target group contains the tenant, applying deny-wins → priority resolution.

## Internal running agents & scheduling

Split by ownership:

- **Platform background agents** (registry sync, drift reconcile, grant recompile-and-push, harvesting, promotion review, eval/SLO harness, token/cert rotation): run as **platform-plane controllers / Kubernetes CronJobs** with their own Workload Identity. Follow existing patterns (`apps/feat-central-agents`, `apps/fleet-operator/src/tenant-rollout`). **Claws do not run these.**
- **Per-tenant scheduled work** ("nightly report for jane"): a **central scheduler owns the schedule + governance**; at fire time it wakes the claw and dispatches the job **as the tenant identity** via the projected-token path. Claws do **not** self-schedule (breaks against `autoSuspend`, `apps/fleet-operator/src/tenants/deploy/2-config-map.ts:70`; loses central audit). Guard the wake/dispatch path: the scheduler may only fire schedules a tenant registered, with a job-scoped token, audited — never a broad impersonation primitive.

## Implementation slices (suggested order)

1. **Identity:** projected-token volume/mount + `OBOT_GATEWAY_URL` / feat-skill-registry URL env in `3-deployment.ts`; remove `OPENCLAW_GATEWAY_TOKEN`; set tenant SA audiences.
2. **Contract:** extend `runtimeContract` in `2-config-map.ts:50` with `gateway`, `mcp.servers` (compiled grant), `skills` (entitled index), `contractVersion`. Demote `entrypoint.sh:73` CSV check to advisory pre-filter.
3. **CRDs:** add `MCPServer`, `ObotConfig`, `SkillBundle`/`SkillRegistry`, and a per-tenant `Schedule` CRD under `platform/helm/crds/`; extend `AccessPolicy.mcpServers` / `Tenant.spec.mcpPolicy` as needed.
4. **Control plane:** shared group-based permission compiler (principals/groups/grants, deny-wins → priority) + group sync/flattening + tier→group seed mapping; `GET /api/tenants/:name/effective-contract` (versioned); config + grant push to both planes; MCP registry routes; skill registry + promotion/demotion routes; Cognee-backed catalog search.
5. **Operator:** reconcile both planes' config + registries; drift detect/repair.
6. **Skill registry service:** new ingress service over OCI/ORAS; scoped `get-by-entitled-digest`; entitlement enforcement; ingest/scan pipeline.
7. **Helm/network:** deploy Obot headless (admin disabled, IdP bound to central OIDC); deploy skill registry + OCI store; NetworkPolicies restricting tenant → plane ingress only (no path to Obot DB or OCI store).
8. **Scheduler:** central per-tenant scheduler that owns schedules and dispatches into claws as the tenant.
9. **UI** (`apps/opencrane-ui`): MCP install, skill catalog/install, permission-set management, schedule management (PrimeNG, shared components per `AGENTS.md`).

## Acceptance criteria (testable)

- A tenant cannot obtain or read another tenant's gateway/downstream token (no shared/guessable credential anywhere).
- Tenant pod filesystem/env contains **no** MCP downstream secret.
- A tenant pod **cannot enumerate or pull any skill outside its compiled entitlement**, including by direct digest or search against the registry.
- Removing a grant denies the next MCP call / skill pull (audited) without a pod restart.
- Adding a grant becomes usable after the next contract re-pull, no restart.
- Manual edits to either plane's config are reverted by drift reconcile.
- Per-tenant schedules survive pod suspension and restarts; claws run no self-owned cron.
- **No scope-tier enum exists** in the compiler, CRDs, contract, or DB — authorization is groups + grants only.
- **No legacy or backwards-compatibility paths remain**: `OPENCLAW_GATEWAY_TOKEN`, the shared-skills PVC + `entrypoint.sh` symlink, the filesystem-only `skillsRouter`, and the CSV MCP allow/deny enforcement are **deleted, not deprecated** — no shims, flags, or parallel branches.
- All new code conforms to `AGENTS.md`.

## Resolved decisions

- **MCP credential custody = central broker.** Obot holds downstream creds; the pod never receives them. **Confirmed.**
- **Skill substrate = build thin over OCI/ORAS + Cognee** (not a ClawHub fork). OCI immutability/digest-pinning meets the plan's intent. **Confirmed.**
- **Authorization = groups, not tiers.** Compiler operates on principals/groups/grants (deny-wins → priority); control plane owns org→group sync, nesting, and tier→priority seeding; tiers are UI-only. **Locked.**
- **No backwards compatibility.** All superseded/legacy wiring is removed as its replacement lands — no shims, flags, or failover branches. **Locked.**

## Out of scope / deferred

- Obot's bundled chat client (discarded).
- Contract *schema* version bumps ride the existing canary rollout, not this work.
- Public-registry browsing inside the agent runtime (humans browse/request via the opencrane-ui only).
