# OpenCrane — Active Plan

> **Rebased 2026-07-05; resequenced 2026-07-07.** Implementation detail lives in **GitHub
> issues** (context + todo checklists); this file is the sequencing index the work is driven
> from. When an item here is executed, work off the linked issue — not this file. History of
> everything landed before the rebase: `plan-done.md` + the git history of this file (the
> pre-rebase plan is at commit `700473b` and earlier).

## Current state (2026-07-05)

`main` @ `700473b`. The silo program (S1–S6) is merged: fleet/silo split, Zitadel as PDP
system-of-record with per-org OIDC login, member API (`oc cluster-tenant members`), S4
inheritance + scope vocabularies + dataset-membership sync, BYOK provider keys, same-origin
org ingress + gateway proxy (built, gated), org-memory (Cognee) wired into tenant pods.

## Execution order

The roadmap is sequenced into cross-repo phases (shared with [weownai's plan](https://github.com/italanta/WeOwnAI/blob/main/plan.md)).
Governing rule: **finish the launch push before starting the Phase 3 restructuring**, because
Phase 3 physically moves the code the launch issues are still changing. Two exceptions are
pulled early — see Phase A and the #150 note in Phase E.

### Phase A — Stabilise the live cluster (gates all live verification)

| Issue | Scope | Why first |
|-------|-------|-----------|
| [#144](https://github.com/italanta/opencrane/issues/144) — **Fail-safe tenant reconcile** | Don't clobber a known-good openclaw ConfigMap when `tenant-models` returns empty/errors · never emit a bare unprefixed model · mark Tenant `Degraded` · unit tests | This is the elewa-be chat-break bug. Until reconcile degrades safely, every live E2E below is flaky. |
| [#134](https://github.com/italanta/opencrane/issues/134) — **Operator & deploy ops hygiene** | Skill-registry env wired through the chart (survives `helm upgrade`) · suspend self-loop `observedGeneration` guard · operator auto-reconcile on config change | Small; stops deploys silently reverting state. Runs alongside #144. |

### Phase B — Backend launch-critical (parallel, independent)

| Issue | Scope | Why |
|-------|-------|-----|
| [#126](https://github.com/italanta/opencrane/issues/126) — **Member onboarding & user lifecycle** | Org-admin signup (ex-#122) · member adoption on first login · internal member-workspace seeding · `POST /tenants` membership-validation + subject binding · S4b groups-as-Zitadel-project-roles · seat caps · offboarding (retain datasets) · provisioning/deploy correctness (ex-#100) | The funnel's missing middle: invited employees can't reach a running assistant today. Pairs with weownai #30. |
| [#127](https://github.com/italanta/opencrane/issues/127) — **Isolation & domaining production defaults** | Default-deny mandatory for multi-CT (ex-#105) · per-ClusterTenant hosts default-ON + purge per-usertenant domains · encrypted tenant storage (CMEK + preflight) · GCP smoke + live ACME e2e | Shipped defaults must match the documented security model before any multi-org production install. |

### Phase C — Frontend launch cutover (weownai)

No opencrane issues. Cross-repo gate: weownai [#28](https://github.com/italanta/WeOwnAI/issues/28)
(live workspace) needs Phase A's stable cluster; weownai #30 pairs with #126. See weownai's plan.

### Phase D — Capability completion (overlaps Phase C's tail)

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#128](https://github.com/italanta/opencrane/issues/128) — **Obot live integration** | Verify mgmt-API/enc-at-rest knob against the live Obot · OBO push path · per-user RFC-8693 round-trip · pod-can't-reach-token-store assertion | None — unblocked by the live Obot. |
| [#129](https://github.com/italanta/opencrane/issues/129) — **Central harvesting harness over Obot MCP** | Declarative harvest jobs · executor as privileged Obot client · Slack connector re-expressed as an MCP-backed job · Teams/email/tickets = config, not code | Credentialed sources need #128; harness can start against credential-free MCP servers. |
| [#130](https://github.com/italanta/opencrane/issues/130) — **Scope-aware retrieval + per-scope memory partitioning** (S4e + P4B.7.2/.3) | ScopeContext in `@opencrane/awareness` · cascade retrieval plugin · `node_set` ingestion tagging · written-memory partitioning | Plugin can land against manual groups; full value after #126's S4b. |
| [#138](https://github.com/italanta/opencrane/issues/138) — **ClusterTenant teardown** | Finalizer-driven silo deprovision · CR-delete + DB-row in one transaction · data-retention policy | Pairs with #126's lifecycle; align teardown semantics with #150's contract. |

### Phase E — Phase 3 repo boundary re-draw (after launch settles)

This repo narrows to a standalone **ClusterTenant template** (deployable alone or fleet-managed
from weownai); the org/clustertenant frontend moves in from weownai, and the fleet backend
moves out to weownai.

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#150](https://github.com/italanta/opencrane/issues/150) — **Fleet↔silo contract + licensing split** | ClusterTenant CR schema + lifecycle API (incl. teardown, see #138) · OIDC delegation payload · relicense `fleet-operator`/`fleet-platform` to private ahead of the move | **DONE (opencrane side, phase3-cutover):** `apps/fleet-operator` + `apps/fleet-platform` removed from this repo (fleet-facing CLI commands and the generated `fleet-api.ts` client removed with them); the fleet backend now lives in WeOwnAI (counterpart: weownai#39, "done"). Deploy scripts/terraform that drove the fleet chart now require an external `FLEET_CHART_DIR`/`fleet_chart_path` pointing at a checked-out WeOwnAI copy. |
| [#151](https://github.com/italanta/opencrane/issues/151) — **Standalone-capable silo** | Decouple identity (OIDC delegation), move `OrgDomainProvisioner` into the silo operator, chart self-sufficiency (SecretStore, NetworkPolicy floor, CRDs), standalone deploy mode | **DONE (phase3-cutover):** item 1 identity decoupling — audited, no code change needed (`docs/design/fleet-silo-contract.md`); item 2 `OrgDomainProvisioner` in-operator + item 3 chart self-sufficiency (CRDs/SecretStore/NetworkPolicy floor) both landed; item 4 standalone deploy mode — single `deploymentMode`/`DEPLOYMENT_MODE` switch (`config.ts` + chart `deploymentMode` value, fanning out `manageTenantNamespaces`/`manageOwnDomain`/the boot-time `_SeedOwnClusterTenant`+`_SeedOwnDefaultTenant` self-seed), `values/standalone.yaml` preset, `values.schema.json` + Helm `fail` coherence guards, docs in `docs/agents/apps/opencrane.md` → "Deployment modes". |
| [#152](https://github.com/italanta/opencrane/issues/152) — **Receive opencrane-ui frontend + org libs from weownai, relicense AGPL** | Land `apps/opencrane-ui` + org feature/state libs, fork shared foundation libs, chart-native frontend deploy, drop the opencrane-api OpenAPI pin | Lockstep with [weownai#38](https://github.com/italanta/WeOwnAI/issues/38); after weownai #41 lands so rendering ports wholesale. |
| [#153](https://github.com/italanta/opencrane/issues/153) — **Adopt NX + diffuse opencrane-api into libs** | NX adoption, extract `src/core/` (40k LOC) into `libs/features/*`, per-feature migration ownership convention | After #151/#152 settle — don't refactor code mid-relocation. |
| [#154](https://github.com/italanta/opencrane/issues/154) — **Plugin system research spike** | Plugin shape (backend module + frontend element + chart + manifest), install procedure, customisation line, hooks inventory, prove-the-seam plugins (skills, MCP, #129 harvesting, #130 awareness, billing, metrics) | Research anytime; design after #153. #129/#130 become prove-the-seam candidates. |
| [PR #3](https://github.com/josphat-otieno/opencrane/pull/3) — **Session + Settings mock UI handoff** | Implement the approved Angular UI against deterministic mocks: shared foundation → concurrent Workspace/Session and Settings lanes → combined responsive/WCAG/visual acceptance → frontend cleanup | UI-only; no backend/API/CLI/OIDC/live-Gateway work; both lanes start at one reviewed `UI_SHARED_READY_SHA` |

#### Session + Settings handoff execution ledger

- Parent status: `in progress`
- Integration branch: `codex/ui-handoff-integration`
- Current scope branch: `codex/ui-mock-scope`
- Readiness SHA: `unset until G1`
- Evidence: [approved and merged PR #3](https://github.com/josphat-otieno/opencrane/pull/3) and [mock-scope PR #4](https://github.com/josphat-otieno/opencrane/pull/4)
- Blocker: `mock-scope PR #4 requires review and merge before G1 implementation starts`

| Wave | Owner | Branch | Allowed paths | Depends on | Status | Evidence | Blocker |
|---|---|---|---|---|---|---|---|
| Mock foundation (G1) | Coordinator | `codex/ui-handoff-integration` | Coordinator manifest paths | approved mock scope | pending | mock scenario matrix, migration inventory, ownership manifest | blocked on scope review |
| Workspace + Session (A1–A4) | Workflow A | `codex/ui-session` | Workflow A manifest paths | `UI_SHARED_READY_SHA` | pending | — | blocked on G1 |
| Settings + sub-pages (B1–B5) | Workflow B | `codex/ui-settings` | Workflow B manifest paths | `UI_SHARED_READY_SHA` | pending | — | blocked on G1 |
| Integration + cleanup (G2–G5) | Coordinator | `codex/ui-handoff-integration` | Coordinator paths + approved G4 deletions | A and B reviewed | pending | — | blocked on lanes |

### Phase F — End-state substrate & deferred (no launch dependency)

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
