# OpenCrane — Active Plan

> **Rebased 2026-07-05; resequenced 2026-07-07; re-lettered 2026-07-16.** Implementation
> detail lives in **GitHub issues** (context + todo checklists); this file is the sequencing
> index the work is driven from. When an item here is executed, work off the linked issue —
> not this file. History of everything landed before the rebase: `plan-done.md` + the git
> history of this file (the pre-rebase plan is at commit `700473b` and earlier).
>
> Phase letters were reset on 2026-07-16 to match where the work actually stands: the launch
> stabilisation phase, member onboarding, and the bulk of the Phase 3 repo cutover are done
> (see Current state), so the active sequence now restarts at **Phase A**.

## Current state (2026-07-16)

The silo program (S1–S6) is merged: fleet/silo split, Zitadel as PDP system-of-record with
per-org OIDC login, member API (`oc cluster-tenant members`), S4 inheritance + scope
vocabularies + dataset-membership sync, BYOK provider keys, same-origin org ingress + gateway
proxy (built, gated), org-memory (Cognee) wired into tenant pods.

Since the rebase, three tranches have completed and dropped out of the active sequence:

- **Launch stabilisation** — fail-safe tenant reconcile ([#144](https://github.com/italanta/opencrane/issues/144)) and operator/deploy ops hygiene ([#134](https://github.com/italanta/opencrane/issues/134)). The live cluster no longer clobbers a known-good config or silently reverts deploys.
- **Member onboarding & user lifecycle** ([#126](https://github.com/italanta/opencrane/issues/126)) — signup → invite → membership → seeded workspace → offboard.
- **Phase 3 repo cutover (bulk)** — standalone-capable silo ([#151](https://github.com/italanta/opencrane/issues/151)), frontend + org-libs receive/relicense ([#152](https://github.com/italanta/opencrane/issues/152)), NX adoption ([#153](https://github.com/italanta/opencrane/issues/153)). Landed on the `phase3-cutover` branch — **pending merge to `main`** (merge gated on the e2e-k3d design call + the k8s-platform subchart vendor-vs-publish decision).

## Execution order

The roadmap is sequenced into cross-repo phases (shared with [weownai's plan](https://github.com/italanta/WeOwnAI/blob/main/plan.md)).
Governing rule: **finish the launch push (Phases A–C) before treating the Phase 3 tail
(Phase D) as anything but bookkeeping + research.** The heavy Phase 3 code moves are already
done; what remains there has no launch dependency.

### Phase A — Isolation & domaining production defaults (current front)

| Issue | Scope | Why first |
|-------|-------|-----------|
| [#127](https://github.com/italanta/opencrane/issues/127) — **Isolation & domaining production defaults** | Default-deny mandatory for multi-CT (ex-#105) · per-ClusterTenant hosts default-ON + purge per-usertenant domains · encrypted tenant storage (CMEK + preflight) · GCP smoke + live ACME e2e | Shipped defaults must match the documented security model before any multi-org production install. Last launch-critical backend item. |

**Chart/code floor DONE** (branch `feat/isolation-domaining-defaults`). The #151 cutover already
landed most of #127; a 2026-07-16 audit found only one code gap, now closed:

- ✅ Default-deny mandatory for multi-CT — Helm `fail` guards on `mainNetworkDefaultDeny` + `multiInstance`.
- ✅ `--preflight` FATAL under `--multi-ct` when no NetworkPolicy-enforcing CNI; storage-class encryption ADVISORY warn (`libs/k8s-platform/k8s-deploy.sh`).
- ✅ Per-usertenant domaining gone: `sameOrigin` is the only hosting mode; docs (`website/security/*`, `website/operators/*`) explicitly deny per-user subdomains.
- ✅ Encrypted tenant storage seam: `tenant.storage.storageClassName` → operator `TENANT_STORAGE_CLASS` → state PVC (tested).
- ✅ **gatewayProxy default-ON for the fleet profile** — added the missing `multiCt ⇒ gatewayProxy.enabled` Helm `fail` guard + schema note, matching the default-deny pattern (prereqs `ingress.externalIp` + `tenant.gateway.trustedProxies` already enforced by the schema `allOf`). `sameOrigin` half was already unconditional.

**Remaining = infra / live-cluster only** (needs a cluster + deploy scripts, not code): GKE
Dataplane V2 + Workload Identity via Terraform · Terraform CMEK-encrypted StorageClass as the
fleet-profile default · GCP installer smoke on a fresh project · live ACME DNS-01 e2e (platform
+ per-org) · live verify non-proxy pod can't reach `openclaw-<tenant>:18789` then re-assess
`dangerouslyDisableDeviceAuth` (currently device-less **by design**, not a dev-only flag). Run
these via `/deploy-loop` when a cluster is available.

### Phase B — Frontend launch cutover (weownai) — ✅ gate satisfied

No opencrane issues. Cross-repo gate: weownai [#28](https://github.com/italanta/WeOwnAI/issues/28)
(live workspace) and [#30](https://github.com/italanta/WeOwnAI/issues/30) (member management UI,
paired with the completed #126) are **both CLOSED** as of 2026-07-16 — the frontend launch
cutover shipped on the WeOwnAI side. Nothing to implement in this repo. See weownai's plan for
any residual hardening.

### Phase C — Capability completion (overlaps Phase B's tail)

Two of the four original items are **done**: #130 (adopted the official Cognee OpenClaw plugin,
replacing bespoke org-memory-mcp) and #138 (ClusterTenant teardown) are both CLOSED. The two
remaining are large epics — decompose into waves before executing.

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#128](https://github.com/italanta/opencrane/issues/128) — **MCP/Obot lifecycle** | Authenticated Obot v0.23.1 mgmt+runtime adapter · real credential custody (singleUser/multiUser) · one authorization authority (reconcile intent → Obot access-control rules) · native OpenClaw `mcp.servers` activation via Obot `connectURL` · encryption/audit | Large epic; several sub-parts need a **live Obot** for verification. Replaces simulated MCP install/credential states. |

**#128 decomposed 2026-07-16** (DAG + waves; execution on `feat/isolation-domaining-defaults`). The whole
MCP app plane is Prisma-only simulation (fake `cred_*`/`oauth_*`); no Obot management client exists.
**Resolved decisions:** ① authz collapse → generic `Grant` is sole authority, `McpServerAccessPolicy`
+ `McpServerGrant` demote to read-only projections. ② obot-gateway k8s SA token → replaced by a
per-tenant **Obot API token** minted/rotated/revoked via the adapter. ③ mode mapping → Personal=`singleUser`,
Shared=`multiUser`. ④ adapter lives in `libs/backend/mcp/main` (interface+logic), factory/wiring in `apps/opencrane`.
**Deferred (W3, live-Obot-gated):** enable-auth-by-default rollout + OIDC federation bootstrap, real custody /
`tools/list` / invocation / encryption verification, re-recording fixtures from a live server.

**Progress (2026-07-16, branch `feat/isolation-domaining-defaults`):**
- ✅ **W0 keystone** — Obot adapter seam (interface+fail-closed noop+factory) + `0033_mcp_obot_lifecycle` migration (Obot-ID/connectURL/observed-state columns). Reviewed clean.
- ✅ **W1.B (mcp-core)** — MCP credential/OAuth driven through the adapter; fake `cred_*`/`oauth_*` minting removed; endpoints fail closed (no "connected" without a real Obot op). 32/32 mcp tests.
- ✅ **W1.E (retrieval)** — SSRF-guarded read-only registry discovery + curated pinned import → Obot entry (fail-closed 503 when Obot absent) + sync reconciliation. 24/24 tests. Security review clean.
- ✅ **W1.F (app+infra)** — the dead `obot-gateway` k8s SA token replaced by a per-tenant Obot API token (mint→Secret→mount→revoke via the adapter), fail-closed to "credential mount absent" (avoids a `Degraded` reconcile hot-loop). 102 tenant tests.
- ⏳ **Remaining:** **W1.A** live Obot HTTP client impl (deferred with W3 — unverifiable without a live Obot to record fixtures) · **W1.C** servers-logic rewrite (create real Obot catalog entries/servers on install; stop returning `secretRef`) · **W1.D** authz collapse (generic `Grant` sole authority; demote `McpServerAccessPolicy`+`McpServerGrant` to read-only) · **W2** native `mcp.servers` activation + reconcile loop + CLI.
- 📝 **Doc/residue follow-ups:** purge stale `obot-gateway.token` refs in `website/integrators/mcp-gateway.md`, `docs/agents/k8s.md`, and the `audiences:["obot-gateway"]` in `apps/feat-skill-registry/.../token-review.test.ts`; add `oc third-party-sources discover/import/check-updates` CLI + OpenAPI for the W1.E routes; consider first-class `ThirdPartySourceItem` Obot-id/syncState columns (currently in `metadata` JSON); pre-existing `McpOperatorCaller` type-in-impl.
| [#129](https://github.com/italanta/opencrane/issues/129) — **Central agents** | Managed org/silo-owned agents: definition CRUD + versioned revisions · triggers (manual + cron) · model policy via LiteLLM · capability grants (skills + imported Obot MCP) · scope-attachment knowledge read/write · scheduler + executor · scoped awareness advertisement | Large epic; reworks `apps/feat-central-agents` from the Slack harvester into the general model. Credentialed MCP capabilities lean on #128. |
| ~~#130 — Cognee OpenClaw plugin adoption~~ | — | **DONE** (closed). |
| ~~#138 — ClusterTenant teardown~~ | — | **DONE** (closed). |

### Phase D — Phase 3 cutover close-out & plugin seam (no launch dependency)

The heavy Phase 3 code moves — standalone silo (#151), frontend receive (#152), NX adoption
(#153) — are **done** on `phase3-cutover` (see Current state). What remains is the contract
close-out and the plugin research spike.

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#150](https://github.com/italanta/opencrane/issues/150) — **Fleet↔silo contract + licensing split** | ClusterTenant CR schema + lifecycle API (incl. teardown, see #138) · OIDC delegation payload · relicense `fleet-operator`/`fleet-platform` to private ahead of the move | **DONE (opencrane side, phase3-cutover):** `apps/fleet-operator` + `apps/fleet-platform` removed from this repo (fleet-facing CLI commands and the generated `fleet-api.ts` client removed with them); the fleet backend now lives in WeOwnAI (counterpart: weownai#39, "done"). Deploy scripts/terraform that drove the fleet chart now require an external `FLEET_CHART_DIR`/`fleet_chart_path` pointing at a checked-out WeOwnAI copy. Issue still open — close out once `phase3-cutover` merges to `main`. |
| [#154](https://github.com/italanta/opencrane/issues/154) — **Plugin system research spike** | Plugin shape (backend module + frontend element + chart + manifest), install procedure, customisation line, hooks inventory, prove-the-seam plugins (skills, MCP, #129 harvesting, #130 awareness, billing, metrics) | Research anytime; design after the cutover merges. #129/#130 become prove-the-seam candidates. |

### Phase E — End-state substrate & deferred (no launch dependency)

| Issue | Scope | Status |
|-------|-------|--------|
| [#117](https://github.com/italanta/opencrane/issues/117) — **Cilium + SPIFFE identity substrate — remove Linkerd** | Cilium CNI · SPIRE/SVID issuance · per-silo `CiliumNetworkPolicy` · super-admin identity rotation/audit · Linkerd removal | After #127's floor is enforced; rollout stays additive. |
| [#133](https://github.com/italanta/opencrane/issues/133) — **Skill-bundle registry-only cutover (S9)** | Live Zot backfill run → drop `SkillBundle.content` | Needs live infra; tooling ready (`oc skills backfill`). |
| [#135](https://github.com/italanta/opencrane/issues/135) — **Provider-secret cutover (S10)** | Remove `org-shared-secrets` broadcast · retire `ProviderApiKey` | **BLOCKED external** (OpenClaw translator image + WeOwnAI). |
| [#136](https://github.com/italanta/opencrane/issues/136) — **Deferred capabilities (S7 · S12 · D4/D5)** | Dedicated-compute tiers & cost model · guardrail stream · plane pooling + scale-to-zero | Future. S7 relies on the same provisioner-webhook seam #150 formalises. |
| [#141](https://github.com/italanta/opencrane/issues/141) — **Cluster-based devops agents (research spike)** | Always-on in-cluster counterpart to the `/deploy-loop` fleet: drift/error detection, pre-upgrade config review — read-only, remediation via PRs/issues | Future; scope + guardrails in the issue. |
| [#131](https://github.com/italanta/opencrane/issues/131) — **CLI & docs polish** (low prio) | `oc providers byok` · README component-table fix · budget-enforcement seam wording | Anytime. |

Folded elsewhere: CONN.4/5 device-seam kill-or-keep → **#117** · live Cognee `/v1/search`
verification → **#130**.
