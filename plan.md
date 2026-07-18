# OpenCrane — Active Plan

> **Rebased 2026-07-16 (evening): personal-agent program adopted.** Implementation detail lives
> in **GitHub issues** (context + todo checklists); this file is the sequencing index the work is
> driven from. When an item here is executed, work off the linked issue — not this file. History
> of everything landed before the rebase: `plan-done.md` + the git history of this file (the
> morning re-lettered plan is at commit `e2b0228`; the pre-rebase plan at `700473b` and earlier).

## Decision record (2026-07-16)

The [personal-agent platform architecture](docs/design/personal-agent-platform-architecture.md) is
**adopted** as the target, with the runtime refinement from the
[OpenClaw loop investigation](docs/design/openclaw-agent-loop-replacement-plan.md):

1. **End state:** an OpenCrane-owned agent runtime. OpenCrane owns Thread/Message/Run/RunEvent,
   approvals, transcript, compaction, retry, budgets, identity, memory, and tool policy; a
   conformance-selected **TypeScript** toolkit (`@openai/agents` primary spike, `ai`/`ToolLoopAgent`
   control) drives only the bounded model/tool loop. Python stays for isolated tool Jobs only.
   Supersedes the 2026-06-19 keep-OpenClaw decision (trigger: personal-agent product pivot).
2. **Delivery:** the [rewrite freeze with whole-silo blue/green replacement](docs/design/personal-agent-platform-rewrite-freeze-plan.md)
   (owner, 2026-07-17: hard rewiring of the openclaw tenant in one go, as far as possible — we
   need that control). The [strangler](docs/design/personal-agent-platform-simplification-plan.md)
   is rejected; there is **no OpenClaw bridge, transcript mirror, or compatibility adapter in
   green**. Per the plan's own limits this is one whole ClusterTenant at a time (never a
   fleet-wide big bang), and **R0 must still run its decision test**: classify every CT
   reset-eligible vs full-fidelity, and if post-write rollback turns out to be mandatory the
   route reverts to strangler — that check is a gate, not a formality. Branch mechanics: `main`
   stays the protected blue maintenance line; green integrates on protected
   `feat/agent-platform-v2` through normal small PRs.
3. **Sequencing:** deletion debt is paid first (Phase A, including deleting the `oc` CLI —
   supersedes #216) and the monorepo is normalized second (Phase B) — both are **pre-freeze**
   work that shrinks the frozen surface and carves the reusable foundations green is allowed to
   import. The program then follows the R-gates: R0 estate audit → R1 stabilize+freeze blue
   (absorbs the launch blockers) → R2/R3 green foundations + migration factory → R4/R5 runtime +
   AgentService → R6 surfaces → R7 rehearsal → R8 dogfood silo → R9 atomic per-CT cutovers →
   R10 legacy deletion.
4. Authority/identity gates 2–9 of the architecture doc (Postgres authority, artifact-on-PVC,
   per-silo authorization + signed run capabilities, Cilium-not-RBAC, CRD retirement, isolated
   Python, controller/proxy extraction, no permanent dual runtime) are accepted with it.
   ADRs recording all of this are a Phase A deliverable (→ [#245](https://github.com/italanta/opencrane/issues/245)).

Toolkit choice is **not** pre-decided — Gate L4's conformance run decides it (→ [#246](https://github.com/italanta/opencrane/issues/246)).

## Current state (2026-07-16)

The silo program (S1–S6) is merged: fleet/silo split, Zitadel as PDP system-of-record with
per-org OIDC login, member API, S4 inheritance + scope vocabularies + dataset-membership sync,
BYOK provider keys, same-origin org ingress + gateway proxy (built, gated), org-memory (Cognee)
wired into tenant pods. Launch stabilisation (#144, #134), member onboarding (#126), and the
Phase 3 repo cutover (#151, #152, #153; merged through PR #212) are done.

Retired from the morning plan: #130 (scope-aware retrieval), #138 (teardown), #141 (devops-agents
spike), #131 (CLI polish) — closed; their residue pointers live in the issues themselves.

## Track 0 — live obligations (now mostly freeze-gating)

Under the rewrite-freeze contract these are no longer merely parallel: the freeze **cannot be
declared** until the pre-freeze runway blockers are done. They execute inside R1's runway.

| Item | Scope | Status |
|------|-------|--------|
| [#127](https://github.com/italanta/opencrane/issues/127) — **Isolation & domaining production defaults** | Mandatory default-deny (multi-CT) · per-CT hosts · encrypted tenant storage · GCP smoke + ACME e2e | **Freeze-gating** (pre-freeze runway condition). |
| [#174](https://github.com/italanta/opencrane/issues/174) — **LiteLLM Team provisioning bug** | team_id 404s on /key/update, unthrottled reconcile | **Freeze-gating** (reconcile storms must be fixed pre-freeze). |
| [#162](https://github.com/italanta/opencrane/issues/162) — **Chart-native OpenCrane UI rollout** | Enablement, migration, status, live verification | **Freeze-gating** (one supportable UI version required). |
| [#150](https://github.com/italanta/opencrane/issues/150) close-out | Phase 3 cutover merged; finish the remaining e2e-k3d and subchart decision work | **Freeze-gating** (one supportable fleet/silo contract version). |
| Frontend launch cutover (weownai) | weownai [#28](https://github.com/italanta/WeOwnAI/issues/28) + #30 | Cross-repo; see weownai's plan — resequence against the freeze at R0. |

## Program — personal-agent platform

Phases A/B are pre-freeze repo work; R0–R10 are the
[rewrite-freeze plan](docs/design/personal-agent-platform-rewrite-freeze-plan.md)'s gates. Issues
for a gate are cut when it opens; issue dispositions from the
[strangler table](docs/design/personal-agent-platform-simplification-plan.md#live-github-issue-disposition)
still apply where noted, re-read through the freeze route.

### Phase A — deletion debt — ✅ COMPLETE (see `plan-done.md`)

Adjacent: [#135](https://github.com/italanta/opencrane/issues/135) stays blocked (external half);
[#227](https://github.com/italanta/opencrane/issues/227) fires after Phase A + rollback windows.

### Phase B — monorepo topology: apps are lightweight rollups

| Issue | Scope | Exit |
|-------|-------|------|
| [#249](https://github.com/italanta/opencrane/issues/249) — **Every deployed unit under `/apps`; logic in `/libs`** | Promote cognee/litellm/obot from embedded opencrane-infra templates to app-owned deploy units (render-parity gated) · extract `apps/opencrane`'s ~20.5k lines (reconcilers, gateways, infra, openapi) into libs · opencrane-infra narrows to umbrella composition · Nx module-boundary guardrail. Apps scheduled to die (feat-openclaw-tenant, feat-central-agents, feat-skill-registry) are **not** churned. | Every deployed pod traces to an `apps/*` rollup; `apps/opencrane` is composition+bootstrap; CI blocks logic under `apps/*`. |

Under the freeze route this phase has a second purpose: it **carves the reuse seam**. Green may
only import clean libs (never legacy domain packages), so extracting the sound foundations —
workload builders, observability, generic k8s utilities, frontend state — into libs before the
freeze is what lets green reuse them instead of rewriting them. Trust-boundary *extraction*
(channel-proxy, agent-controller as processes) is built fresh in green at R2, into this structure.

### R0 — estate audit and irreversible decisions (opens with Phase A)

Classify every ClusterTenant **reset-eligible vs full-fidelity** (dev/staging estate is expected
to be largely reset-eligible — verify, don't assume); frozen capability catalog; grant
deny/priority + project-scope handling; persona precedence (DB docs vs mutable files); credential
adopt-vs-reconnect; **post-write rollback decision** (if mandatory → route reverts to strangler);
cohort order; maintenance windows; sign-off authority. Records the ADRs (with #245). Issue cut at
open.

### R1 — stabilize, snapshot, freeze blue

The pre-freeze runway = Track 0 blockers (#127, #174, #162, fleet/silo contract) + Phase A/B +
the slot-neutral cutover supervisor. Then: execute **Gate L0** (immutable pinned image — #245's
deliverable — golden fixtures, trajectory recorder) against the frozen artifact; tag/sign the
frozen source/image/chart/config manifest (`openclaw-freeze-YYYYMMDD`); blue maintenance matrix
(0.5–1 engineer reserved, security-class fixes only). [#225](https://github.com/italanta/opencrane/issues/225):
only its stabilization-critical parts land pre-freeze; the rest of its OpenClaw gateway/A2UI
scope dies with blue. [#220](https://github.com/italanta/opencrane/issues/220): least-privilege
profile becomes a freeze condition.

### R2/R3 — green foundations + migration factory (parallel; on `feat/agent-platform-v2`)

Green app topology (owner naming, 2026-07-17): the runtime app is **`apps/feat-personal-agent`**
(supersedes `apps/feat-openclaw-tenant` at its silo's R9 cutover; the design docs' provisional
`apps/agent-runtime` name is overridden). There is **no separate skill-registry app in green**:
the skill catalog is an OpenCrane API module and skill bytes live in the artifact service —
`apps/feat-skill-registry` freezes with blue and dies at R10. **Pod↔app rule (owner, 2026-07-17): everything that becomes a pod is registered as an app.
Apps are templates — instantiated multiple times where necessary.** Every pod class in the
cluster traces to exactly one `/apps` unit that owns its image and deploy templates; instances
(per user, per agent, per run) are workloads of that app. The green pod-class map:

| Pod class | Owning app |
|---|---|
| Control-plane API / UI / channel proxy / agent controller / artifact service | `apps/opencrane`, `apps/opencrane-ui`, `apps/channel-proxy`, `apps/agent-controller`, `apps/artifact-service` |
| Cognee / LiteLLM / Obot | `apps/cognee`, `apps/litellm`, `apps/obot` (#249 promotes these) |
| Personal agent pods (one per user) | `apps/feat-personal-agent` |
| First-party managed agents (one workload each) | `apps/agents/<name>` — per-agent lightweight rollups (persona/skills/schedule/budget manifest over shared runtime libs); replace `apps/feat-central-agents` at R5 |
| Tenant/user-created managed agent pods | `apps/feat-managed-agent` — the shared managed-runtime rollup; the agents themselves are AgentService records (created at runtime), their pods are this app's workloads |
| Isolated authoring/tool Jobs, migration-factory Jobs, and every other Job class | Each gets a named owning app; enumerated exhaustively in R2's app→KSA→network identity matrix — an unowned pod class fails the R2 gate |

**R2:** target app packages (into the Phase B structure), green Postgres schema
(AgentService/Run/Thread/Message/RunEvent/Approval/Persona/Artifact/Skill), authorization facade +
proof-bound capabilities, channel-proxy + agent-controller as apps, artifact CAS, app-owned
Cognee/Obot, Cilium/default-deny as cutover-blocking ([#117](https://github.com/italanta/opencrane/issues/117)
executes here), identity matrix ([#221](https://github.com/italanta/opencrane/issues/221)
generalizes here), active-slot/quarantine controls. CI forbids legacy/OpenClaw imports from the
first green PR.
**R3:** exporters/importers per the legacy-state table (or the reduced reset/archive/reconnect
factory if R0 classifies the estate reset-eligible); signed per-silo reconciliation manifests.
[#128](https://github.com/italanta/opencrane/issues/128) reframes to the green Obot adapter +
credential adoption/reconnect list.

### R4/R5 — personal runtime + AgentService plane (parallel)

**R4** (→ [#246](https://github.com/italanta/opencrane/issues/246), rescoped): Gates **L3–L5** —
`RunInputSnapshot` + prompt compiler, toolkit conformance bake-off (`@openai/agents` vs
`ai`/`ToolLoopAgent`) against frozen trajectories + live LiteLLM, one exact-pinned driver, the
reliability envelope, persona/PreferenceFact learning, multimodal + document authoring, governed
Python skill Jobs ([#222](https://github.com/italanta/opencrane/issues/222) executes green-side;
[#243](https://github.com/italanta/opencrane/issues/243) rides it). **No OpenClaw compatibility
anywhere in green.**
**R5:** AgentService/Revision/Run + schedules + one-attempt Jobs + one-way personal→managed
boundary ([#129](https://github.com/italanta/opencrane/issues/129) promotes to this epic; Slack
worker re-lands as schedule+MCP+skill).

### R6 — product and operator surfaces

One UI/API path: conversation/persona/memory, agent catalog + revision publish/rollback,
schedules/runs, approval inbox, assets, skills, membership + effective-access explorer
([#226](https://github.com/italanta/opencrane/issues/226),
[#224](https://github.com/italanta/opencrane/issues/224) execute green-side). Upstream consoles
are diagnostics only.

### R7/R8 — rehearsal, qualification, dogfood

Deterministic import rehearsals on production-shaped snapshots (3× identical manifests; abort +
crash-at-every-phase drills; DR exercise); then one internal ClusterTenant runs **entirely** on
green through the full acceptance matrix. Go/no-go signed independently of the implementers.

### R9 — atomic per-ClusterTenant cutovers

One silo at a time, cohort-ordered (internal/reset-eligible → small full-fidelity → largest):
fence fleet mutations → maintenance mode → drain → write barrier → blue quarantine (proven fence)
→ checkpoint-bound export/import → verify manifest → green quarantined start → read-only handoff
(CAS, epoch bump) → commit → credential custody transfer → monotonic
writes/models/tools/schedules activation. Rollback is clean **only before the commit**; after
green writes, recovery is forward (accepted at R0).

### R10 — decommission and replace main

After the last retention window: green branch replaces `main`; delete the frozen blue platform,
OpenClaw surface, Tenant/AccessPolicy CRDs, active-slot machinery;
[#231](https://github.com/italanta/opencrane/issues/231) naming pass and
[#227](https://github.com/italanta/opencrane/issues/227) image cleanup land here; docs/website
sync; CI checks against retired concepts.

## Deferred / research

| Issue | Scope | Status |
|-------|-------|--------|
| [#136](https://github.com/italanta/opencrane/issues/136) — Dedicated-compute tiers · guardrail stream · pooling/scale-to-zero | Re-lands as green AgentService deployment profiles (post-R9) | Future. |
| [#154](https://github.com/italanta/opencrane/issues/154) — Plugin system spike | Replaced per disposition: green app/module contracts come from Cognee/Obot/artifact/runtime needs — no generic plugin framework | Re-scope after R2. |
| [#133](https://github.com/italanta/opencrane/issues/133) — Zot-only skill cutover | **Superseded by the freeze route**: skills convert to ArtifactVersions in R3/R4; Zot is not ported into green. Close at R0 with the frozen-catalog decision. | Supersede at R0. |
