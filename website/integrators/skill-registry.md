# Skill Registry & Delivery

How OpenCrane catalogs, scans, entitles, and delivers **skill bundles** to tenant
agents. Like Obot, it is split: the control plane is the **source of truth**
(catalog, scanning, entitlements); the in-cluster **Skill Registry** app is the
**delivery gate** that tenant pods pull from.

> See also: [obot.md](/integrators/mcp-gateway) (the sibling MCP plane),
> [agent-workspace.md](/integrators/agent-workspace) (how the agent becomes aware of its skills),
> [auth.md](/security/identity) (token audiences), and [hosting-architecture.md](/operators/hosting).

## Planes at a glance

```
author/promote ──▶ Control plane (SkillBundle rows, scan, grants)
                        │  GET /api/internal/bundles/:digest/content?tenantName=…
                        ▼  (scanStatus=passed + live entitlement check)
                   Skill Registry app  ──serves /bundles/:digest──▶ tenant pod
                        ▲                                            (OpenClaw)
   aud=feat-skill-registry projected token ─────────────────────────────┘
```

The agent pulls **only entitled, scan-passed** bundle content over HTTP, one digest
per request. Pods have no list/search verb: delivery is existence-hiding (a
non-entitled or unknown digest returns `404`, never `403`).

## The catalog (control plane)

`SkillBundle` Prisma model (`apps/opencrane/prisma/schema/skills.prisma`): `id`, `name`,
`description`, `version`, `digest` (unique on `name+version+digest`), `content` (the
raw skill markdown), `scope` (org/department/project/personal), `status`
(Draft/Review/Published), `tags`, optional `sourceId`, and the scan fields
`scanStatus` / `scanFindings` / `scannedAt`. Related rows: `SkillEntitlement`
(grant-backed access), `SkillPromotion` (scope-transition history).

CRUD + lifecycle live at `/api/v1/skills/catalog`
([skill-catalog.ts](https://github.com/italanta/opencrane/blob/main/libs/backend/skills/main/src/routes/skill-catalog.ts)); use the generated contracts client or authenticated REST requests.

## Lifecycle: scan → validate → register → entitle → promote

1. **Author / ingest.** Create a bundle (Draft); third-party sources (Anthropic
   skills, git, manual) ingest through the same pipeline. Creating a bundle directly
   as `published` is rejected — it must be scanned first.
2. **Scan.** `POST /api/v1/skills/catalog/:id/scan` runs a vulnerability scan
   ([scan-bundle.ts](https://github.com/italanta/opencrane/blob/main/libs/backend/skills/main/src/core/scan-bundle.ts)): probes
   the PATH for **Grype**, then **Trivy**; if neither is present it returns
   `scanner-unavailable` (graceful — does not crash). Findings of **critical/high**
   severity fail the scan. Outcome persists to `scanStatus` / `scanFindings` /
   `scannedAt` and is audited.
3. **Promote gate.** `PUT /api/v1/skills/catalog/:id` **rejects promotion to
   `published` unless `scanStatus = passed`**. Lower-severity findings are recorded
   but non-blocking.
4. **Entitle.** Entitlements are grants (`GrantCompilerPayloadType.SkillBundle`) at a
   scope (org/department/project/personal) for a subject (group/tenant/user), allow or
   deny, with priority. The grant compiler resolves the effective decision per tenant.
5. **Promote across scopes.** `SkillPromotion` records scope transitions (e.g.
   project → org) with an approval status; informational history, not a runtime gate.

## Delivery (how a bundle reaches a pod)

1. The operator injects a projected token with **audience `feat-skill-registry`** at
   `/var/run/opencrane/tokens/feat-skill-registry.token`, plus
   `OPENCRANE_SKILL_REGISTRY_URL`
   ([3-deployment.ts](https://github.com/italanta/opencrane/blob/main/apps/opencrane/src/reconcilers/tenants/deploy/3-deployment.ts)).
   No shared storage volume is mounted for skill delivery; the live mechanism is the
   per-entitlement HTTP pull below.
2. The pod calls **`GET /bundles/:digest`** on the Skill Registry service with that
   token ([apps/feat-skill-registry/src](https://github.com/italanta/opencrane/blob/main/apps/feat-skill-registry/src)).
3. The Skill Registry validates the token via Kubernetes **TokenReview** (audience
   `feat-skill-registry`, tenant name parsed from the
   `system:serviceaccount:<ns>:<tenant>` subject), then proxies to the control plane.
4. The control plane's **`GET /api/internal/bundles/:digest/content?tenantName=…`**
   ([skill-bundles.ts](https://github.com/italanta/opencrane/blob/main/libs/backend/skills/main/src/routes/internal/skill-bundles.ts))
   gates on: bundle exists → `scanStatus = passed` (else `422 SCAN_FAILED`) → a **live
   grant-compiler allow** for that tenant (else `404`, existence-hiding) → returns the
   content with `X-Skill-Name` / `X-Skill-Digest` headers.

Both internal endpoints are **NetworkPolicy-gated** (in-cluster only) rather than
behind `___AuthMiddleware`; the Skill Registry's TokenReview adds defence in depth.
Entitlement is checked **live per request**, so a revoked grant stops delivery on the
next pull.

## Contract surface

The effective contract (re-pulled by the pod) lists entitled bundle ids under
`skills.entitled`. This is advisory for the pod; the authoritative gate is the live
per-request entitlement check at delivery time. The list is compiled from the same
AccessPolicy and grant decisions used to render the agent's platform-owned `TOOLS.md`.

## Current state & gaps

- ✅ Catalog CRUD, scan (Grype/Trivy) + promote gate, entitlement grants, audit.
- ✅ Skill Registry delivery app: TokenReview + proxy, scan/entitlement gates,
  existence-hiding, per-read delivery.
- 🔶 OCI/ORAS (Zot) digest-pinned bundle storage: **built, gated; cutover in
  progress.** The store, dual-write on publish, digest-verified delivery, and a
  backfill tool for existing bundles all exist behind
  `skillRegistry.ociStore.enabled` (default `false` — see
  [skill-oci-store.yaml](https://github.com/italanta/opencrane/blob/main/apps/opencrane-infra/templates/skill-oci-store.yaml)),
  so today bundle `content` is still served from the opencrane-api DB through the
  registry. The `digest` field already pins identity, so flipping the flag changes
  only the storage backend, not the delivery contract. Tracked in
  [issue #133](https://github.com/italanta/opencrane/issues/133).
