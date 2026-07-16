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

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#128](https://github.com/italanta/opencrane/issues/128) — **Obot live integration** | Verify mgmt-API/enc-at-rest knob against the live Obot · OBO push path · per-user RFC-8693 round-trip · pod-can't-reach-token-store assertion | None — unblocked by the live Obot. |
| [#129](https://github.com/italanta/opencrane/issues/129) — **Central harvesting harness over Obot MCP** | Declarative harvest jobs · executor as privileged Obot client · Slack connector re-expressed as an MCP-backed job · Teams/email/tickets = config, not code | Credentialed sources need #128; harness can start against credential-free MCP servers. |
| [#130](https://github.com/italanta/opencrane/issues/130) — **Scope-aware retrieval + per-scope memory partitioning** (S4e + P4B.7.2/.3) | ScopeContext in `@opencrane/awareness` · cascade retrieval plugin · `node_set` ingestion tagging · written-memory partitioning | Plugin can land against manual groups; full value after #126's S4b. |
| [#138](https://github.com/italanta/opencrane/issues/138) — **ClusterTenant teardown** | Finalizer-driven silo deprovision · CR-delete + DB-row in one transaction · data-retention policy | Pairs with #126's lifecycle; align teardown semantics with #150's contract. |

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
