# Phase D open-PR review — consolidated findings and fix plan (2026-07-19)

Self-contained handoff for the implementing agent. Covers every open PR on `italanta/opencrane`
as of 2026-07-19: the Phase D stack **#268→#289**, docs PRs **#265**/**#267**, umbrella draft
**#262**, and pre-pivot **#241**.

Produced by nine independent review passes: seven correctness/security reviewers over each PR's
incremental diff, one architecture gate (on-targetness vs `plan.md` Phase D, ADR 0008, ADR 0009,
and `AGENTS.md` structural rules), and one reaper pass over the combined stack diff
(`origin/own-personal-ai-agent-setup...origin/feat/agent-platform-v2-phase-d-dev-resource-profile`,
497 files, +24671/−15086).

---

## 1. Verdict

**Architecturally strong stack; NOT mergeable as-is.** Two migration-level Criticals, two
architecture-gate structural blocks, four High findings, one un-reaped legacy subsystem, and no CI
coverage above the bottom PR. Separately, five named Phase D exit-criteria items are entirely
unbuilt — Phase D must not be declared exited when this stack merges.

**Critical process fact:** CI only ran on **#268** (7 green checks — it targets the integration
branch `own-personal-ai-agent-setup`). PRs **#269–#289** target each other's `feat/*` heads and
**never triggered a single workflow**. Nothing above #268 has been compiled, tested, linted, or
helm-templated by CI. Both Criticals below are of the class CI would normally catch.

### Stack topology (bottom → top; each PR's base is the one below it)

```
own-personal-ai-agent-setup
 └─ #268 foundations ─ #269 artifact CAS ─ #270 artifact service ─ #271 controller foundation
     ─ #272 attempt fencing ─ #273 authority API ─ #274 authority persistence ─ #276 profile binding
     ─ #277 authority server route ─ #278 controller deploy ─ #279 adapters tests ─ #280 health
     ─ #281 workload ownership ─ #282 runtime Job boundary ─ #283 RBAC negative tests
     ─ #284 Cilium enforcement ─ #285 Cilium profiles ─ #286 integration authority
     ─ #287 Obot custody ─ #288 persona approval ─ #289 dev resources
```

`#275` dangles off the side of this chain (see §6 — close it). `#262` is the umbrella draft
(`own-personal-ai-agent-setup → main`).

---

## 2. BLOCKING — fix before any merge

### 2.1 #268 — missing drop migration for routing-measurement tables (Critical; found independently by two passes)

The Prisma schema deletes models `RoutingEvalCase`, `RoutingMeasurement`, `RoutingProposal` and
enum `SkillModelMode` (formerly in `apps/opencrane/prisma/schema/model-routing.prisma`, created by
migrations 0017–0021), but **no migration drops the database objects**: tables
`routing_proposals`, `mrl_eval_cases`, `mrl_measurements` and types `RoutingProposalStatus`,
`SkillModelMode`. Result: schema↔database drift; `npx prisma migrate deploy` refuses to run.

**Fix:** add a migration (e.g. `0050_drop_routing_measurement_tables`) with
`DROP TABLE IF EXISTS "routing_proposals", "mrl_eval_cases", "mrl_measurements";` and
`DROP TYPE IF EXISTS "RoutingProposalStatus", "SkillModelMode";` — mirror the pattern the same
commit used correctly in `0043_skills_artifact_backed_replacement/migration.sql`.

**Why CI missed it:** the live-Postgres authority suite only runs where psql/Docker exist. Run
`scripts/run-postgres-authority-tests.sh` (or `prisma migrate diff` against a fresh DB) in k3d
before merging.

### 2.2 #286 — migration trigger references an undefined function (Critical)

`apps/opencrane/prisma/migrations/0049_integrations_authority/migration.sql:158` creates a trigger
calling `enforce_agent_revision_assignment_immutability()`. That function is **defined nowhere in
the migration history**. `CREATE TRIGGER` fails at execution, blocking #286 and everything stacked
above it (#287–#289).

**Fix:** define the function in migration 0049 (model it on the sibling immutability triggers from
#272's migration, e.g. `enforce_agent_run_execution_subject_immutable`), or remove the trigger if
the constraint is covered elsewhere. Then prove it with the live-Postgres suite.

### 2.3 Architecture gate: two structural moves (BLOCK — direct moves, no design decisions)

1. **`apps/artifact-service/src/server.ts` (#270) embeds the CAS business protocol in the app.**
   Lease verification (`__VerifyArtifactWriteLease`), content-length capping → 413, absolute
   deadline enforcement (`setTimeout`/`request.destroy`), `store.stage → store.promote`
   orchestration, and receipt signing all live in the app entrypoint, unit-tested by booting a real
   HTTP server. The sibling app in the same stack shows the correct pattern:
   `apps/channel-proxy/src/server.ts` only adapts transport and delegates to
   `libs/backend/channel-proxy/main`.
   **Fix:** extract a typed-outcome `__PromoteArtifactUpload(store, leaseVerifier, boundedByteSource, config)`
   into `libs/backend/artifacts/store/main` (or a new `libs/backend/artifacts/promotion/main`);
   reduce the app to HTTP-outcome translation; move the protocol tests to the lib.
2. **`apps/channel-proxy/project.json` uses the legacy wildcard tag `scope:app`** (which maps to
   `onlyDependOnLibsWithTags: ["*"]`). `docs/agents/monorepo.md` explicitly instructs replacing the
   layer-shaped `scope:backend|web|shared|app` tags. Every other new app in this stack uses a
   bounded scope (`agent-controller`→`scope:agents`, `artifact-service`→`scope:artifacts`,
   `postgres`→`scope:postgres`, `cilium`→`scope:network`), and channel-proxy's own lib is already
   `scope:channel-proxy`.
   **Fix:** retag `apps/channel-proxy/project.json` to
   `["type:app", "layer:entrypoint", "scope:channel-proxy"]` and add/reuse the matching
   depConstraint in `eslint.config.mjs`.

### 2.4 Run the full validation gate (nothing above #268 has ever been built)

```bash
npx nx affected -t build test lint \
  --base=own-personal-ai-agent-setup \
  --head=feat/agent-platform-v2-phase-d-dev-resource-profile
npm run lint:boundaries
bash scripts/phase-b-topology.sh                      # workload-ownership.json render check
bash scripts/phase-a-forbidden-references.sh
bash scripts/integration-authority-negative-tests.sh
LIVE_CLUSTER=1 bash scripts/runtime-identity-negative-tests.sh   # needs a live cluster
bash scripts/cilium-runtime-profile-contract.sh
bash scripts/run-postgres-authority-tests.sh          # needs k3d/psql — validates §2.1 and §2.2
```

Also consider fixing the root cause: CI never triggers on stack-internal `feat/* → feat/*` PRs.
Either add a workflow trigger for `feat/agent-platform-v2-*` head branches or merge the stack
bottom-up promptly so each PR retargets the integration branch and gets CI.

---

## 3. HIGH — needs changes before merge

| PR | Location | Defect | Fix |
|---|---|---|---|
| #278 | `apps/agent-controller/helm/templates/_resources.tpl:300` | Helm `required` passes on empty string; default `agentController.kubernetesApi.cidr: ""` renders a NetworkPolicy with `cidr: ""` that Kubernetes **rejects** — controller can reach neither the K8s API nor OpenCrane | `fail` at render when `agentController.enabled=true` and cidr is empty; same treatment for empty `agentController.runtimeImage` (currently only caught at controller startup config validation) |
| #270 | `libs/backend/artifacts/authorization/main/src/artifact-lease.ts:23` | Lease `iat` bounded only against future skew (`> now+5`); an arbitrarily old signed lease still verifies. Safe today only because of the `capabilityJti` uniqueness constraint | add past bound: reject when `iat < now − 300` (5-min skew tolerance both directions) |
| #270 | `apps/artifact-service/tests/helm-contract.sh:27-29` | Test forbids RBAC but never asserts the artifact-service NetworkPolicy exists and restricts egress; an incomplete NP template would pass silently | assert the NP renders and denies egress except PVC/required internal targets |
| #287 | `libs/.../integration-custody-provisioning.ts:11,30` (`__ProvisionIntegrationCustody`) | Two bare `catch {}` blocks return fail-closed outcomes (`remote_unavailable`, `compensation_failed`) with **no structured log** — operators can't diagnose why custody provisioning failed | add `@opencrane/observability` structured log lines (correct level, structured fields, no secrets) on both paths |
| #265 | `docs/design/openclaw-agent-loop-replacement-plan.md:49-50,96` | Canonical events define `steering.queued`/`steering.absorbed` but **not `steering.deferred`**; `plan.md` Phase E exit ("one visible `steering.absorbed` or `steering.deferred` outcome") and amended ADR 0008 ("visibly deferred") require an explicit deferred event, not the absence of absorption | add `steering.deferred` to the canonical event list, define when it fires (terminal transition wins), and update the `steering-after-finalization-starts-next-run` acceptance fixture |

---

## 4. Reaper — "fully reaped" verdict: **NOT YET** (two must-do items)

### 4.1 DELETE — dead skill-registry consumer (producer deleted in #268, consumer never touched)

#268 cleanly deleted the `feat-skill-registry` app, its chart templates, chart values
(`skillRegistry.*`, `ociStore.*`), the server route `/api/internal/bundles`, and the contract
fields `contract.skills.entitled`/`contract.skills.models`. But the blue-side consumer still ships
in every OpenClaw tenant pod as a provably-dead subsystem:

- `apps/opencrane/src/app/config.ts:94` — `skillRegistryUrl` defaults to
  `http://opencrane-feat-skill-registry.<ns>.svc:5000`, a Service that no longer exists in any
  template; nothing sets `SKILL_REGISTRY_URL` (0 hits in charts).
- `apps/opencrane/src/__tests__/config.test.ts:71` — asserts the stale default (co-delete).
- `libs/backend/feat-openclaw-tenant/main/src/operator-config.types.ts:77` — `skillRegistryUrl` field.
- `libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/deploy/2-config-map.ts:232` —
  stamps `skills: { registry: ..., entitled: [] }` into the bootstrap ConfigMap; comment claims the
  Skill Registry is an "authoritative boundary" (false).
- `libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/deploy/3-deployment.ts:66,68,167,169` —
  `OPENCRANE_SKILL_REGISTRY_URL`/`OPENCRANE_SKILL_REGISTRY_TOKEN_PATH` env vars and a projected SA
  token volume with `audience: "feat-skill-registry"` — kubelet mints and rotates a token nobody
  serves, in every tenant pod.
- `libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/deploy/workspace/AGENTS.md:15`
  and `.../workspace/TOOLS.md:15` — tell the agent to fetch skills from an unreachable URL.
- `libs/backend/feat-openclaw-tenant/main/src/__tests__/fixtures.ts:46` and
  `.../tenants/tenant-resource-builder.test.ts:54,205,210,408,410,423` — tests locking in the dead
  wiring (co-delete/update).
- `apps/feat-openclaw-tenant/deploy/entrypoint.sh:12,20,25-26,138-170,226,332,430,433` — the whole
  `_pull_entitled_skills` function: a shipped silent no-op (`entitled` is always `[]`; `|| true`
  swallows the dead-DNS case).
- `apps/feat-openclaw-tenant/README.md:49` — env-var doc line.

Full retirement is the documented intent (`docs/agents/apps/opencrane.md:133`: "Delete retired
registry skill delivery… Do not complete or stabilize these predecessor paths") and no replacement
was wired into the consumer — this is DELETE, not a swap. Net ≈ −120…−160 lines, one fewer
projected-token mount and env-var pair per tenant pod.

### 4.2 DELETE — orphaned routing tables (same as §2.1)

### 4.3 REWRITE — doc/comment residue naming the deleted plane as live

- `docs/agents/k8s.md:83,102` and `docs/agents/cluster-architecture.md:204` — claim the
  `feat-skill-registry.token` projected token is "real and actively consumed" (now false).
- `docs/agents/infra.md:31` — lists `feat-skill-registry` among `values.yaml` planes (block removed).
- `website/integrators/agent-workspace.md:21,123` — two lines survived the same edit pass that
  fixed seven others in that file (self-residue).
- `website/operators/networking.md:41,104,158,160,180,203`, `website/operators/hosting.md:436`,
  `website/operators/fleet-silo-model.md:53`, `website/operators/silo-deployment.md:16,56,79,105`,
  `website/security/identity.md:75` — operator docs describing a deployed skill-registry Service on
  port 5000 with its own NetworkPolicy.
- `libs/backend/server/model-routing/main/src/routes/internal/tenant-models.ts:107` — comment
  points at a file this stack deleted.
- `libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/deploy/silo-baseline-network-policy.ts:41` —
  comment lists `feat-skill-registry` among reachable planes.

### 4.4 Verified clean (no action)

Linkerd removal (493 lines, no dangling refs; inventory allowlist shrank 17 entries),
`session_scopes` drop (schema + migration 0039, textbook), frontend skills-section deletion (0
remaining refs), controller-authority router has exactly one fail-closed call site,
`__UnavailableObotCustodyAdapter` is genuinely fail-closed (throws; not a fake-success path).

### 4.5 Expected-later legacy (correctly deferred — do NOT delete in this stack)

Tenant/AccessPolicy CRD authority (dies when target authorization APIs land), `OPENCRANE_API_TOKEN`
static bearer + dev-mode auth bypass (dies with the target authorization facade), OpenClaw gateway
protocol/pairing (blue-frozen, dies at replacement), model-routing BYOK/LiteLLM core (untouched,
unrelated to the measurement-loop trim). Historical briefs/research docs referencing the registry
stay as historical record.

### 4.6 Post-reap verification

```bash
npx vitest run libs/backend/feat-openclaw-tenant/main/src/__tests__/tenants/tenant-resource-builder.test.ts
npx vitest run apps/opencrane/src/__tests__/config.test.ts
git grep -n "feat-skill-registry\|SKILL_REGISTRY_URL\|skillRegistryUrl" -- apps libs docs website   # expect 0 live hits
git grep -n "routing_proposals\|mrl_eval_cases\|mrl_measurements\|SkillModelMode\|RoutingProposalStatus" -- apps/opencrane/prisma  # only CREATE+DROP history
```

---

## 5. On-targetness — Phase D coverage vs plan.md / ADR 0008 / ADR 0009

### Covered by this stack (verified)

- Target Postgres models matching ADR 0008 vocabulary and replay-guard shape: AgentService/Revision/
  Run, ConversationThread/Message/ConversationRunEvent, ApprovalRequest, PersonaProfile/Revision,
  Artifact/ArtifactRevision, SkillRevision, AuditEntry/AuthorizationDecisionRecord, membership
  projection (VerifiedFleetMembershipRevision/Assertion), RunProofKey, RunInputSnapshot.
- Authorization facade + proof-bound capabilities (`libs/models/authorization/main`).
- Channel proxy as separate trust-boundary app delegating session/membership decisions to OpenCrane.
- Agent controller as the only new K8s RBAC subject (namespaced Role, `batch/jobs` + `pods` read
  verbs + job mutation only; **narrower than ADR 0008's full matrix row** — fine while agent-runtime
  is Job-only; flag at the next scheduling slice).
- ArtifactStore CAS (lease → stage → promote → signed receipt) + outbox rows.
- Inert agent-runtime Job (no automount, zero RBAC live-verified via `kubectl auth can-i`,
  deny-ingress, DNS+OTEL egress only, suspended by default).
- Default-deny Cilium profiles bound to labels **and** ServiceAccount identity; contract + live tests.
- CNPG Postgres with backup/restore exercised in `k3d-e2e.sh`.
- Deletions: `feat-skill-registry` app/chart/route, Zot `skill-oci-store`, `SessionScope`,
  `networkpolicy-planes.yaml`, model-routing eval/measurement/proposal routes, `linkerd.ts` helper.
- Every rendered workload has an exact `apps/`/`apps/_infra/` owner; `workload-ownership.json`
  updated; zero new executable OpenClaw references; no compat shims or bridges anywhere in the diff.

### MISSING — named Phase D exit criteria with zero hits at stack HEAD

These are gaps for subsequent Phase D PRs. **Phase D must not be marked exited until they land.**

1. **Workload-authenticated fenced run-ingest API + post-commit SSE projection.** The only internal
   controller↔opencrane API is `controller-authority.router.ts` (desired-job claim + workload/Pod
   observation). No route accepts `RunEvent` candidates for fenced idempotent persistence; no SSE
   endpoint exists (`grep -i "sse\|EventSource\|text/event-stream"` → 0 hits in runs/conversations libs).
2. **Durable steering inbox, model-decision boundary claim, steering event contracts,
   input-generation terminal guard.** Zero occurrences of steering/inbox/absorb in schema or
   backend libs. Named in plan.md Phase D text, direct-refactor plan, ADR 0008 critical journey 7.
3. **`apps/_infra/opensandbox` + OpenSandbox adapter + confined deployment boundary + negative
   RBAC/network/admission tests.** ADR 0009: "Phase D must create [these] before any execution
   feature uses it." No trace of opensandbox anywhere in `apps/` or `libs/`.
4. **Real Obot custody adapter.** Only the fail-closed placeholder exists. ~80% of PR #241's
   reviewed slices remain unported (issue #255 assigns them to Phase D): W0 `ObotManagementClient`
   interface + `_NoopObotClient`, W1.B MCP credential/OAuth adapter wiring, W1.E SSRF-guarded
   registry discovery + curated import, W1.F per-tenant Obot API token lifecycle.
5. **`apps/silo-provisioner` deterministic fresh-store Job.** Salts/credentials (e.g.
   `LITELLM_SALT_KEY`) are still generated imperatively inside
   `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` rather than the target-owned Job named in the
   direct-refactor plan's ownership table.

Nothing in the stack is OFF-target: no Phase E/F scope smuggled in, no OpenClaw bridges, no
compatibility endpoints, no dual writes.

### Skills status (asked separately; recorded for completeness)

The skills **model** is in good shape: `apps/opencrane/prisma/schema/skills.prisma` defines
Skill/SkillRevision with Draft→Review→Published/Rejected/Revoked lifecycle, content-addressed
ArtifactStore binding, trust classes (`ReviewedInstructions`/`SandboxedPython`), scan/test/signing
fields, plus a `libs/backend/server/skills` publication lib with tests. But it is storage/governance
only — **no delivery or execution path exists** until Phase E (#222: governed Python skill Jobs on
OpenSandbox — which itself doesn't exist yet, gap §5.3). Blue tenants currently have zero skill
delivery (the dead consumer of §4.1 is a silent no-op); that is the documented intent, but the dead
wiring must go so nobody mistakes it for a working capability.

---

## 6. Housekeeping actions

- **Close #275.** Byte-identical superseded duplicate of #277 (same diff; stale base
  `...-controller-authority-persistence` instead of `...-persistence-profile`). Canonical chain:
  #272→#273→#274→#276→#277.
- **Keep #241 open** until the four unported slice groups (§5.4) land; its failing CI is moot
  (pre-pivot branch).
- **Rerun #265's failing check.** `k3d standalone-silo e2e smoke test` failed because the k3d agent
  node entered a restart loop during cluster creation — pre-existing runner/infra flake; the PR is
  docs-only and cannot affect it.
- **#267 (ADR cleanup): LGTM, mergeable.** Verified no still-referenced ADR is deleted; all
  cross-references updated inline; steering language consistent with plan.md.
- **#262** is the umbrella draft — leave until the stack integrates.

---

## 7. Per-PR verdict table

| PR | Title (short) | Verdict | Blocking items |
|---|---|---|---|
| #268 | Phase D foundations | **needs-changes** | §2.1 drop migration |
| #269 | ArtifactStore CAS mechanics | LGTM | — (path traversal + atomic promotion verified) |
| #270 | Artifact service + authority | **needs-changes** | §2.3.1 move, §3 iat bound + NP test |
| #271 | Agent controller foundation | LGTM | error handling deferred to composition (acceptable; document whether `createSuspended` throws) |
| #272 | Attempt fencing | LGTM | — |
| #273 | Controller authority API | LGTM | — (fail-closed TokenReview verified: wrong aud/identity→401, unavailable→503) |
| #274 | Authority persistence | LGTM | — (lock order consistent; lease expiry correct) |
| #275 | Authority server route (dup) | **CLOSE** | superseded duplicate of #277 |
| #276 | Profile binding | LGTM | — |
| #277 | Authority server route | LGTM | — |
| #278 | Deploy bounded controller | **needs-changes** | §3 empty-CIDR render guard |
| #279 | Deployment adapter tests | LGTM | — |
| #280 | Controller health probes | LGTM | readiness≠liveness correctly decoupled |
| #281 | Workload ownership registry | LGTM | — |
| #282 | Inert runtime Job boundary | LGTM | Phase E must use a dedicated bootstrap listener (policy is point-in-time) |
| #283 | Runtime RBAC negative tests | LGTM | tests are non-vacuous |
| #284 | Cilium enforcement boundary | LGTM | GKE Terraform module still Autopilot-only (loud preflight fail — document migration) |
| #285 | Cilium runtime profiles | LGTM | Low: `cilium-runtime-profile-live.sh:211` message says "public" for internal port 8081 |
| #286 | Integration authority | **BLOCKING** | §2.2 undefined trigger function |
| #287 | Obot custody foundation | **needs-changes** | §3 silent catch, no structured logs |
| #288 | Persona approval persistence | LGTM | — (atomic, proof-bound; stale/foreign/incomplete cases tested) |
| #289 | Dev plane reservations | LGTM | live reschedule proof is a documented follow-up |
| #265 | Steering design contracts | **needs-changes** | §3 `steering.deferred`; rerun flaky check |
| #267 | ADR cleanup | LGTM | — |
| #262 | Umbrella draft | n/a | — |
| #241 | Pre-pivot Obot W0+W1 | keep open | §5.4 port incomplete |

---

## 8. Suggested execution order

1. Fix §2.1 (drop migration, in/atop #268) and §2.2 (trigger function, in #286) — these unblock the
   whole chain; restack the branches above each fix.
2. Apply the two §2.3 architecture moves (artifact-service extraction in/atop #270; channel-proxy
   retag) and the three §3 code fixes (#278 CIDR guard, #270 iat bound + NP test, #287 logging).
3. Land the reap slice (§4.1 consumer deletion + §4.3 doc rewrites) — either atop the stack or as
   its own PR against the integration branch; include the §2.1 migration if not already landed.
4. Fix #265's `steering.deferred` definition; rerun its flaky check; merge #265 and #267.
5. Run the full §2.4 validation gate across the stack (build/test/lint/boundaries + negative tests
   + live-Postgres suite in k3d).
6. Close #275. Merge the stack bottom-up into `own-personal-ai-agent-setup` so each PR gets real CI
   as it retargets.
7. Open the remaining Phase D slices from §5 (run-ingest+SSE, steering inbox, opensandbox,
   real Obot adapter port from #241, silo-provisioner) — Phase D exits only when those land and the
   exit criteria (fresh-environment provisioning from target artifacts alone, fail-closed IAM and
   network negative tests, backup/restore of target stores, no reachable legacy contract) all pass.
