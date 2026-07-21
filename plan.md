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

## Architecture review gate — personal-agent platform

The proposed [personal-agent platform architecture](docs/design/personal-agent-platform-architecture.md)
defines one lean OpenCrane-owned, OpenClaw-free end state. Two delivery strategies are under
review: the
[deletion-gated strangler](docs/design/personal-agent-platform-simplification-plan.md) and the
[rewrite freeze with whole-silo blue/green replacement](docs/design/personal-agent-platform-rewrite-freeze-plan.md).
Both keep Postgres/OpenCrane as the authority for silo-owned business state and fleet
membership/lifecycle as explicit upstream contracts; they differ in when legacy changes stop, when
users see value, how state is migrated, and where cutover/rollback risk sits.
The focused [OpenClaw loop investigation](docs/design/openclaw-agent-loop-replacement-plan.md)
traces the pinned runtime and defines the toolkit bake-off and parity gates shared by either route.

These documents are **under review and do not yet resequence the phases below**. Their Gate 0 or R0
first records the accepted decisions and then rebases the live GitHub issue inventory; this avoids
rewriting implementation issues around an architecture that has not been accepted.

## Execution order

The roadmap is sequenced into cross-repo phases (shared with [weownai's plan](https://github.com/italanta/WeOwnAI/blob/main/plan.md)).
Governing rule: **finish the launch push (Phases A–C) before treating the Phase 3 tail
(Phase D) as anything but bookkeeping + research.** The heavy Phase 3 code moves are already
done; what remains there has no launch dependency.

### Phase A — Isolation & domaining production defaults (current front)

| Issue | Scope | Why first |
|-------|-------|-----------|
| [#127](https://github.com/italanta/opencrane/issues/127) — **Isolation & domaining production defaults** | Default-deny mandatory for multi-CT (ex-#105) · per-ClusterTenant hosts default-ON + purge per-usertenant domains · encrypted tenant storage (CMEK + preflight) · GCP smoke + live ACME e2e | Shipped defaults must match the documented security model before any multi-org production install. Last launch-critical backend item. |

### Phase B — Frontend launch cutover (weownai)

No opencrane issues. Cross-repo gate: weownai [#28](https://github.com/italanta/WeOwnAI/issues/28)
(live workspace) needs the stabilised cluster; weownai #30 pairs with the completed #126. See weownai's plan.

### Phase C — Capability completion (overlaps Phase B's tail)

| Issue | Scope | Dependency |
|-------|-------|------------|
| [#128](https://github.com/italanta/opencrane/issues/128) — **Obot live integration** | Verify mgmt-API/enc-at-rest knob against the live Obot · OBO push path · per-user RFC-8693 round-trip · pod-can't-reach-token-store assertion | None — unblocked by the live Obot. |
| [#129](https://github.com/italanta/opencrane/issues/129) — **Central harvesting harness over Obot MCP** | Declarative harvest jobs · executor as privileged Obot client · Slack connector re-expressed as an MCP-backed job · Teams/email/tickets = config, not code | Credentialed sources need #128; harness can start against credential-free MCP servers. |
| [#130](https://github.com/italanta/opencrane/issues/130) — **Scope-aware retrieval + per-scope memory partitioning** (S4e + P4B.7.2/.3) | Session scope projected into the official Cognee plugin · cascade retrieval · `node_set` ingestion tagging · written-memory partitioning | Plugin can land against manual groups; full value after #126's S4b. |
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
| ~~[#141](https://github.com/italanta/opencrane/issues/141) — Cluster-based devops agents (research spike)~~ | ~~in-cluster counterpart to `/deploy-loop`~~ | **Closed 2026-07-13 (not planned).** |
| ~~[#131](https://github.com/italanta/opencrane/issues/131) — CLI & docs polish~~ | ~~`oc providers byok` · README table · budget wording~~ | **Closed 2026-07-13 (not planned)** — moot after the `oc` CLI was deleted 2026-07-16 (#248). |

**Phase E status (2026-07-21):** no executable work in this repo today. #141/#131 are closed; #117 is gated on Phase A #127 and runs green-side at R2; #133 needs a live-cluster backfill run; #135 is blocked externally; #136 is future. Phase E advances only once Phase A lands and the green R-sequence opens.

Folded elsewhere: CONN.4/5 device-seam kill-or-keep → **#117** · live Cognee `/v1/search`
verification → **#130**.
