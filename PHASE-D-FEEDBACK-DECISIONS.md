# Phase D — feedback & decisions (working doc, 2026-07-19)

Running record of decisions and feedback developed while reviewing the Phase D stack
(#268–#289). Consolidate into ADRs / issues at the end of the session.

---

## Decision D1 — one PostgreSQL server per ClusterTenant, multiple databases inside it

**Status:** DECIDED (Jente, 2026-07-19). Reverses the topology introduced by #268.

**Context.** #268 replaced the imperative CNPG provisioning in `k8s-deploy.sh` with the app-owned
`apps/postgres` chart, and in doing so changed the database topology from **one shared CNPG Cluster
per silo holding sibling databases** (opencrane + obot + litellm + langfuse) to **a separate CNPG
Cluster per authority**. The deploy path now calls `_install_postgres_target` up to four times per
silo (opencrane, fleet, obot, litellm).

A CNPG `Cluster` reconciles into real Postgres pods: `instances: 1` → 1 pod + 1 PVC; HA
(`instances: 3`) → 3 pods + 3 PVCs. So per silo the footprint went from **1 Postgres pod serving 4
databases** to **up to 4 Postgres pods (dev) / up to 12 (HA)**, each with its own PVC, memory
reservation, and connection baseline — even on an idle silo.

**Decision.** Revert to **one database server (one CNPG Cluster) per ClusterTenant, with multiple
logical databases inside it** (`opencrane`, `obot`, `litellm`, `langfuse`, `fleet` as appropriate).
The per-authority-cluster split is rejected: the idle resource multiplier is not justified for a
multi-silo personal-agent platform.

**Credential model (refinement, Jente 2026-07-19).** One shared *server*, but **each database has its
own distinct role/user and its own credential Secret** — a separate `username`/`password` per
database, and one published connection Secret per database whose URI targets only that database with
only that role. Roles are least-privilege: each owns/accesses only its own database; no cross-database
grants; no shared owner role across databases. This is *stronger* than the pre-#268 model, which
reused a single `${DB_USER}` owner across all sibling databases (obot/litellm/langfuse were all
`OWNER ${DB_USER}` behind one credential) — that shared-owner reuse is also rejected.

Net target: **1 server pod + 1 PVC per silo (dev)**, **N databases**, **N roles**, **N credential
secrets**. Cheap like the old shared cluster; isolated like the per-authority split.

**Rationale.**
- Resource efficiency at silo scale is the priority; N× idle Postgres pods/PVCs per silo is waste.
- Per-database roles/secrets give the credential isolation that matters (a leaked or rotated
  obot credential cannot touch litellm or opencrane data; blast radius is one database) without
  paying for separate servers.
- The remaining benefits of fully separate clusters (independent PITR, major-version upgrades, no
  shared migration history) do not outweigh the idle cost here.

**Implications / follow-ups.**
- Keep `apps/postgres` as the app-owned chart (that ownership move is good and on-target), but its
  contract should be **one Cluster hosting N databases, each with its own role + credential Secret**,
  not one Cluster per database. Restore the multi-database bootstrap (the deleted
  `CREATE DATABASE obot/litellm/langfuse` behaviour) as declarative chart config, and extend it to
  provision a distinct owner role per database and publish one connection Secret per database.
  `publish-app-connection-secret.sh` becomes per-database, not per-cluster.
- Update `apps/_infra/deploy-k8s/values.yaml:12` and **ADR 0002 decision 3** — they still say "Each
  silo runs ONE CNPG cluster," which the D1 decision realigns with (the drift flagged as feedback A).
- Resolves feedback C (resource multiplier) and subsumes the langfuse gap (feedback B): langfuse
  returns as a database inside the single shared cluster.
- This is the target contract for the `apps/silo-provisioner` fresh-store Job (still unbuilt,
  Phase D gap §5.5 in the review) — it should provision one server + N databases + N credentials.

---

## Decision D2 — collapse Prisma migrations to a single baseline

**Status:** DECIDED (Jente, 2026-07-19).

**Context.** 50 migrations exist at the Phase D stack HEAD (39 pre-stack). Much of it is
create-then-drop churn: `0017`–`0021` build the model-routing measurement tables and `0050` drops
them; `0012` creates session scope and `0039` drops it; `0005`–`0007` build skill bundles and `0043`
replaces them; `0001`–`0033` (pre-pivot) are largely dismantled by `0034`–`0050`. Migration history
exists to evolve a *production* database safely — but `plan.md` states there is no production estate
to preserve, and Phase D's exit criterion is "a fresh environment is created from reviewed target
artifacts alone." So the history has no value; it just replays legacy create-then-drop DDL on every
fresh provision.

**Decision.** Collapse all migrations to a **single `0001_init` baseline** generated from the final
target `schema.prisma`. Do this at a clean checkpoint — after the Phase D stack merges and the schema
settles, and **before any environment is provisioned for real** (a squash cannot cross a real
database). Aligns with the no-compat / direct-refactor posture; every environment is provisioned
fresh from the target schema.

**Bonus.** A squashed baseline is internally consistent by construction, so it retires both migration
Criticals from the review for free: the `0049` undefined-function trigger bug and the `0050`/#268
schema-drift both disappear.

**GOTCHA (must-do for whoever executes it): preserve the raw-SQL triggers/functions.** 13 migrations
(`0034`–`0049`) contain hand-written `CREATE TRIGGER` / `CREATE FUNCTION` SQL — the immutability,
run-fencing, and lifecycle guards that many security properties depend on. Prisma `migrate diff`
generates DDL from `schema.prisma` only and does **not** capture these; a naive squash silently drops
all 13 and guts the guarantees. The baseline must be (schema-generated DDL) **+** every preserved
raw-SQL trigger/function block. Verify with the live-Postgres authority suite after squashing.

**Also:** dev DBs reset via `prisma migrate reset` (no production ⇒ no data-loss risk).

---

## Decision D3 — user-facing backup policy per ClusterTenant (toggle · frequency · retained copies)

**Status:** DECIDED (Jente, 2026-07-19). Builds on D1 (one Postgres instance per ClusterTenant).

**Context.** Today backups on `apps/postgres` are configured only as raw Helm values
(`backup.enabled/schedule/immediate/plugin`) injected through the deploy script's single
`--postgres-values` file, on top of a CNPG-I plugin + object-store the operator wires out of band.
There is no retention/copy-count control in the chart (retention lives in the external object-store
resource), and no per-ClusterTenant surface. Backup storage is a cost the ClusterTenant owner bears,
but they have no knob to control it.

**Decision.** Provide a **user-facing backup-policy surface at the ClusterTenant level** with three
controls:
1. **Enabled** — toggle backups on/off.
2. **Frequency** — how often a backup is taken (schedule).
3. **Retained copies** — how many backups to keep. Explicitly surfaced because retention drives the
   storage bill; the surface should make the cost implication visible (more copies / higher frequency
   = more storage).

One policy per ClusterTenant covers the single per-CT Postgres instance and all its databases
(D1) — no per-authority backup config needed.

**Implementation notes.**
- The policy reconciles into the per-CT `apps/postgres` CNPG config: toggle → `backup.enabled`;
  frequency → `backup.schedule`; **retained copies → a retention policy that must be wired through
  to the CNPG-I plugin / ObjectStore** (retention is currently out-of-band; the copy-count control is
  only real if the chart/reconcile actually enforces it, not left to a hand-edited object-store
  resource).
- Surface belongs with the product/operator surfaces (Phase F,
  [#224](https://github.com/italanta/opencrane/issues/224)); the reconcile-to-CNPG plumbing is
  Phase D/infra. Show the storage-cost implication next to the controls.
- Guardrails: sensible defaults, min/max frequency, retained copies ≥ 1 when enabled; enabling
  without a configured destination stays fail-closed (as today).
- Restore / PITR remains the operator-side counterpart (`restore.*`), not part of this user toggle.

**Audience.** The ClusterTenant owner/admin (they bear the storage bill), not the platform end-user.

---

## Decision D4 — all test files live under a `__tests__/` subfolder (no co-located `*.test.ts`)

**Status:** DECIDED (Jente, 2026-07-19).

**Context.** The repo convention is `__tests__/` (baseline: 112 tests under `__tests__/` vs 3 outside;
`nx.json` has a `!{projectRoot}/src/__tests__/**` exclusion; `app-source-allowlist.json` classifies
app tests under `src/__tests__/` as `composition-test`). The Phase D stack broke it: 43 newly-added
test files are co-located next to source (`foo.ts` + `foo.test.ts`) instead of in `__tests__/`.
Tests have leaked into standard lib/app source.

**Decision.** Every test file MUST live in a `__tests__/` subfolder of its package `src/`. Move all
46 offenders (43 stack-new + 3 pre-existing baseline strays) into `__tests__/` and fix the relative
imports (`./foo` → `../foo`). **Add an ESLint rule** (e.g. forbid `*.test.ts` outside `**/__tests__/`)
so CI fails on regression — the convention is currently only implied by nx globs + practice, not
enforced.

**Offenders (stack HEAD).**

_Apps (in governed `apps/*/src` — also relevant to app-source-allowlist classification):_
- `apps/agent-controller/src/{config,controller-loop,health}.test.ts`
- `apps/artifact-service/src/server.test.ts`
- `apps/opencrane/src/infra/artifacts/artifact-upload.factory.test.ts`

_Libs (new in stack):_
- `libs/backend/agent-controller/kubernetes/src/{controller-authority-http-client,kubernetes-job-mutator}.test.ts`
- `libs/backend/agent-controller/main/src/agent-controller.test.ts`
- `libs/backend/agent-runtime/job-template/src/job-template.test.ts`
- `libs/backend/artifacts/authorization/main/src/artifact-lease.test.ts`
- `libs/backend/artifacts/filesystem/main/src/filesystem-artifact-store.test.ts`
- `libs/backend/artifacts/store/main/src/{artifact-promotion,artifact-store}.test.ts`
- `libs/backend/channel-proxy/main/src/{channel-proxy,target-resolver}.test.ts`
- `libs/backend/server/agent-services/main/src/{agent-publication,prisma-agent-publication}.test.ts`
- `libs/backend/server/artifacts/main/src/{artifact-finalization,artifact-upload,prisma-artifact-authority}.test.ts`
- `libs/backend/server/audit/main/src/audit-decision.test.ts`
- `libs/backend/server/authorization/main/src/{canonical-json-digest,capability-proof,effective-access,prisma-authorization-grants,prisma-runtime-authority,runtime-proof}.test.ts`
- `libs/backend/server/channel-targets/main/src/{channel-target-resolution,prisma-channel-target-authority}.test.ts`
- `libs/backend/server/conversations/main/src/conversation-authority.test.ts`
- `libs/backend/server/integrations/main/src/{integration-custody-provisioning,prisma-integration-authority,prisma-integration-custody-repository}.test.ts`
- `libs/backend/server/membership/main/src/{membership-authority,prisma-membership-authority}.test.ts`
- `libs/backend/server/memory/main/src/memory-catalog.test.ts`
- `libs/backend/server/personas/main/src/persona-authority.test.ts`
- `libs/backend/server/runs/main/src/{controller-authority.router,prisma-controller-authority,prisma-run-authority,run-authority}.test.ts`
- `libs/backend/server/skills/main/src/skill-publication.test.ts`
- `libs/server/_infra/obot-custody/src/unavailable-obot-custody.test.ts`

_Pre-existing baseline strays (sweep too):_
- `libs/models/artifacts/main/src/artifact-invariants.test.ts`
- `libs/models/platform-policy/main/src/platform-policy.test.ts`
- `libs/server/_infra/api/src/watch-runner.test.ts`

**Note.** The `nx.json` `!{projectRoot}/src/__tests__/**` line can be dropped once the ESLint rule
guarantees `__tests__/` is the only test location (the `!**/*.test.ts` line already covers inputs).

---

## Decision D5 — split library namespaces: operator code under `/server/`, agent code under `/agents/`

**Status:** DECIDED (Jente, 2026-07-19).

**Context.** The new Phase D domain libs all landed under `libs/backend/server/*` regardless of whether
they are operator/control-plane concerns or personal-agent product concerns. That conflates two
different planes in one namespace.

**Decision.** Differentiate by top-level namespace:
- **`libs/backend/server/..`** — operator / control-plane / fleet-and-silo code (tenants,
  cluster-tenants, grants, membership, policies, providers, spend, metrics, audit, identity, …).
- **`libs/backend/agents/..`** — personal-agent product code, under a `personal/` scope for the
  personal-agent surface.

Concrete first move: **`libs/backend/server/personas/main` → `libs/backend/agents/personal/personas/main`**
(domain packages keep the `/main` sub-package convention).

**Implication / follow-up.** The other new Phase D domain libs must be classified as operator vs agent
and moved accordingly. Likely **agent** (→ `libs/backend/agents/personal/..`): `personas`,
`conversations`, `runs`, `memory`, and possibly `artifacts`/`channel-targets` (agent-run product
surface). Likely **operator** (stay `libs/backend/server/..`): `membership`, `authorization`,
`integrations`, `agent-services` (the managed lifecycle/authority plane) — to be confirmed per lib,
not presumed here. Dependency direction and the `depConstraint`/scope tags in `eslint.config.mjs`
update with the moves; CI boundary rules must reflect the new `agents` namespace.

**Note.** This lands cleanly *before* the D-lib README pass — write each new README against the final
namespace, not the current `server/` path, so READMEs don't immediately go stale. (README pass for the
46 README-less libs is paused pending this reorg + the per-lib operator/agent classification.)

---

## Decision D6 — `__FilesystemArtifactStore` and `ArtifactStore` need more detailed comments

**Status:** DECIDED (Jente, 2026-07-19).

**Context.** `libs/backend/artifacts/filesystem/main/src/filesystem-artifact-store.ts` is ~247 lines
with only ~21 comment lines (~8.5%) over security- and correctness-critical filesystem operations
(`stage`, `promote`, `read`, `purge`, `_writeAll`, `_hashFile`, `_syncDirectory`). The store contract
in `libs/backend/artifacts/store/main/src/artifact-store.ts` (`ArtifactStore` +
`__Validate*` guards) carries only terse one-line JSDoc. These are exactly the paths where a comment
must state the constraint the code can't show — but they are the thinnest-documented.

**Decision.** Add explanatory comments capturing the non-obvious *why*, specifically:
- **Atomicity / crash-durability** in `promote`/`_writeAll`/`_syncDirectory` — why staging then atomic
  rename, why the directory fsync, what guarantee holds after a crash mid-write.
- **Content-address integrity** — why the hash is verified against the declared address before
  promotion, and the idempotent-promotion semantics (same address ⇒ no-op).
- **Path safety** — how content addresses are constrained so a staging handle or address can't escape
  the store root (path-traversal guard).
- **Lease/validation invariants** — on each `__Validate*` guard, state the invariant it enforces and
  the fail-closed consequence, not just what field it checks.

Comment the constraints and guarantees, not the line-by-line mechanics. Applies as the artifact
libraries are finalized (and dovetails with the architecture-gate move of the promote protocol out of
`apps/artifact-service` into `libs/backend/artifacts/*`).

---

## Decision D7 — `apps/artifact-service` needs better documentation

**Status:** DECIDED (Jente, 2026-07-19).

**Context.** The app is thinly documented across every layer: no `README.md` at stack HEAD (only
drafted on the `feat/phase-d-app-readmes` branch, not landed); `src/server.ts` is 101 lines with ~6
comment lines (~6%) despite carrying the security-critical promote protocol (lease verification, size
cap → 413, absolute deadline, stage→promote, receipt signing); and there is no dedicated
`docs/agents/apps/artifact-service.md` agent-facing doc (contrast `docs/agents/apps/opencrane.md`).

**Decision.** Bring the app's documentation to parity across three layers:
1. **README** — land an `apps/artifact-service/README.md` (draft exists) stating what the app owns,
   how it deploys, and its trust/resource boundary.
2. **Inline comments** — document the *why* on the promote path (why signed leases in and signed
   receipts out, the deadline/size-cap enforcement, fail-closed rejection). This lands where the
   protocol lives after the architecture-gate move out of `apps/artifact-service` into
   `libs/backend/artifacts/*`; keep the app shell's HTTP-outcome translation explained. Dovetails
   with D6 (artifact store/filesystem comments).
3. **Agent-facing doc** — add `docs/agents/apps/artifact-service.md` following the house pattern
   (ownership, contracts, boundaries), so the app is documented like `opencrane`.

---

## Decision D8 — flag `libs/backend/server/artifacts/main` (#270) for a focused quality + docs review

**Status:** DECIDED (Jente, 2026-07-19). Action: schedule a dedicated review before this lib is
considered done.

**Context.** The artifact authority lib introduced in
[#270](https://github.com/italanta/opencrane/issues/270) drops balls on both code quality and the
repo's documentation standards:
- **Thin comments on security-critical code.** `prisma-artifact-authority.ts` (95 lines, ~7 comment
  lines) persists artifact write/finalization authority; `artifact-upload.ts` (23 lines, 1 comment)
  and `artifact-finalization.ts` (27 lines, 4 comments) carry near-zero explanation of their
  invariants.
- **No `README.md`** for the package (D5/README-pass gap, called out specifically here).
- **Co-located tests** (`artifact-upload.test.ts`, `artifact-finalization.test.ts`,
  `prisma-artifact-authority.test.ts`) instead of `__tests__/` (D4 offenders).
- **Open correctness/coverage findings already on #270** from the PR review: lease `iat` has no past
  bound (`artifact-lease.ts`), and the helm contract test never asserts the artifact-service
  NetworkPolicy restricts egress. These live in sibling artifact packages but are the same slice.

**Decision.** Before `libs/backend/server/artifacts/main` is accepted, run a focused review covering:
invariant/why-comments on the authority + upload + finalization paths (per D6/D7 standard), a package
README, `__tests__/` relocation (D4), and closure of the #270 review findings (iat past-bound, NP
egress assertion). Treat the whole artifact slice (this lib + `libs/backend/artifacts/*` +
`apps/artifact-service`) as one quality pass, since D6/D7/D8 and the architecture-gate move all land
on it.

---

## Decision D9 — stack-wide review pass: documentation standards + reduce duplication

**Status:** DECIDED (Jente, 2026-07-19). Generalizes D6/D7/D8 from specific spots to all Phase D code.

**Decision.** Run a review over **all code written in the Phase D stack** on two axes:

**1. Documentation standards** (the D6/D7/D8 bar, applied everywhere):
- A `README.md` for every package (apps + libs) — the D-scope README pass.
- Invariant / "why" comments on non-trivial and security-critical paths (authority persistence, proof
  and lease verification, filesystem CAS, controller reconcile, fencing), stating the constraint the
  code can't show — not line-by-line narration.

**2. Reduce duplication — pull repeated logic into reusable utilities or model it once:**
- Sweep for logic reimplemented across packages and consolidate it, either into a functional utility
  package (`@opencrane/util` / a shared lib) or by **better domain modelling** so the behaviour lives
  once in `libs/models/*` and callers depend on it.
- Candidate duplication to check (illustrative, confirm during the sweep): reading the rotating
  audience-bound projected workload token (channel-proxy, agent-controller HTTP client,
  artifact-service all read a projected SA token fresh per call); the `__Validate*` guard idiom
  (`trim().length > 0`, `mediaType.includes("/")`, `Number.isSafeInteger`) repeated across
  artifact-store/capability/lease; Kubernetes `TokenReview` audience/identity checks; DPoP/proof
  envelope verification; fail-closed `catch`→typed-reason patterns; Prisma lock-ordering + outbox
  write helpers repeated across the `*-authority` persistence files.

**Mechanism.** Prefer one canonical implementation behind a clean domain model over N near-copies;
keep apps thin and logic in libs (repo convention). Pairs with the architecture-gate altitude
findings. Best run as one pass per slice (artifact slice, controller/authority slice, channel slice)
rather than file-by-file.

---

## Decision D10 — review `if` clauses for behaviour modelling (polymorphism vs aspect)

**Status:** DECIDED (Jente, 2026-07-19). Companion to D9 (control-flow / modelling lens).

**Decision.** Review the conditional-heavy code in the Phase D stack and, for each significant `if`
cluster, ask whether branching is the right model or a smell:
- **Polymorphism / subclass / strategy** — when the branches switch on a *type or variant*, model the
  variant instead of testing it. E.g. `workloadKind: "job" | "deployment"` and similar discriminators
  threaded through capability, proof, and controller code are candidates for a per-variant type rather
  than repeated `if (kind === ...)`.
- **Aspect / guard chain outside the main flow** — when the `if`s are *validation / precondition /
  fail-closed* checks, lift them out of the happy path so the main flow reads as intent. E.g. the
  capability-proof verifier (`capability-proof` — a long linear chain of `if (mismatch) return reason`
  across ~30 `CapabilityProofFailureReason` cases) and the `__Validate*` guard bodies are candidates
  for an ordered, named validator pipeline / decision aspect, keeping the enforcement path declarative
  and the reason-mapping in one place.

**Goal:** the main flow expresses *what* happens; variant behaviour lives in types, and
precondition/validation lives in guards/aspects — not inline branching. Judgement call per cluster
(don't over-abstract a two-branch `if`); flag the ones where the branching obscures the model.

---

## Decision D12 — comment `ControllerAuthorityRepository` / `PrismaControllerAuthorityRepository` with consumer + intent

**Status:** DECIDED (Jente, 2026-07-19). Concrete instance of the D9 documentation standard.

**Context.** `ControllerAuthorityRepository` (the port, `controller-authority.types.ts:78`) and
`PrismaControllerAuthorityRepository` (the Prisma adapter, `prisma-controller-authority.ts:18`) carry
only a terse one-line "what it does" JSDoc ("derives all desired workload state from canonical rows").
Neither says **who calls it or why it exists** — the load-bearing context for the reader.

**Decision.** Add class-level comments that state:
- **Consumer** — the controller-authority internal API / router (`controller-authority.router.ts`),
  invoked by the `apps/agent-controller` reconciler over the workload-authenticated internal route, is
  the only caller. Human/product code does not use this repository.
- **Why it exists** — it is the fail-closed persistence boundary for controller claims (claim desired
  job → record Job → record Pod), so a controller crash or duplicate reconcile can neither lose work
  nor double-run it; all authority is derived from canonical rows, never from controller-supplied
  state. State the port-vs-adapter split (interface = the contract the router depends on; Prisma class
  = the one durable implementation).

Apply the same consumer + intent standard to the sibling `*-authority` repositories flagged in D9.

---

## Decision D11 (FINAL TASK) — performance analysis of every added step

**Status:** DECIDED (Jente, 2026-07-19). The closing task for the Phase D review.

**Ask.** Quantify the **performance impact of each step the Phase D stack adds** to the request/run
path — per-step latency and throughput cost, hot paths, and per-run/per-event/per-action
amplification — so the security/correctness machinery's runtime price is known, not assumed.

**Steps to measure (enumerate cost per invocation and how often it fires):**
- **Capability-proof verification** — ES256/DPoP signature verify + full binding comparison per
  action (`capability-proof`); fires per authorized action.
- **Kubernetes `TokenReview`** — a live API-server round trip per controller/internal request
  (`controller-authority` API, channel-target resolve, artifact lease). Network-bound; check caching.
- **Run-ingest commit-before-SSE** — every visible callback persisted as a `RunEvent` (DB write) then
  read back for cursor SSE delivery; per event on long runs — likely the dominant hot path.
- **Fenced boundary claim / steering absorb** — idempotent boundary transaction per model-decision
  boundary.
- **Authority-repo transactions** — the multi-row lock-ordered `$transaction`s in the `*-authority`
  Prisma repos (claim/record/finalize) per state transition.
- **Artifact lease + receipt** — Ed25519 sign/verify per upload; stage→hash→promote (full-content
  SHA-256) per artifact.
- **Per-database connections (D1 context)** — connection-pool footprint; simplified once D1 collapses
  to one server per ClusterTenant.
- **Cilium default-deny + identity-bound policies** — per-connection policy evaluation overhead.

**Method.** Micro-bench the crypto/verify steps in isolation; measure the DB steps against a real
Postgres (the live authority suite harness); model the per-run amplification (events × verify × DB
writes) for a representative long task; call out anything O(events) or O(actions) on the request path.
Report a per-step cost table + the top 3 optimization targets. Run after D1 (topology) lands so the
DB numbers reflect the target shape.

---

## Decision D13 — document `_LoadControllerAuthorityConfig` in code and on the website authority page

**Status:** DECIDED (Jente, 2026-07-19). Instance of the D9 documentation standard, extended to
reader-facing docs.

**Context.** `_LoadControllerAuthorityConfig` (`apps/opencrane/src/app/controller-authority.config.ts:4`)
is the fail-closed gate that mounts the controller authority route only when the full identity +
runtime-profile configuration is present, returning `null` (route absent) otherwise. Today it carries
one JSDoc line, and the website's authority/identity page (`website/security/identity.md`) has **zero**
mention of the controller-authority plane, capabilities, or this config gate.

**Decision.** Document it at both levels:
- **In code** — expand the JSDoc to state the exact required configuration (audience, expected
  ServiceAccount/namespace identity; runtime-profile image digest, TTL bounds, DNS-label names), the
  fail-closed contract (any missing/invalid field → `null` → route never mounted → the controller
  cannot obtain authority), and *why* it fails closed rather than defaulting.
- **On the website** — add a controller-authority section to the authority page
  (`website/security/identity.md`, per the `website` agent house style): how the controller
  authenticates (Kubernetes `TokenReview`), how this config gate makes the authority route present
  only under complete, safe configuration, and how it fits the capability / proof-bound model (the
  page currently documents neither). This closes the reader-facing gap, not just the code comment.

---

## Decision D14 — author a dedicated website chapter on security & architecture (the whole authority model)

**Status:** DECIDED (Jente, 2026-07-19). Expands D13's website scope from one page to a full chapter.

**Context.** The website has no home for the target security/architecture story. `website/security/`
holds only three blue/OpenClaw-era pages (`identity.md`, `connection-security.md`,
`zitadel-key-rotation.md`), buried inside the collapsed "Operating OpenCrane" nav group; `website/
advanced/architecture.md` is a single page. **None of it documents the Phase D authority model** —
capabilities, proofs, controller authority, workload identity, fail-closed authorization, run fencing,
or the target run/data architecture. D13 asked for the controller-config gate on "the authority page";
the real need is the whole model documented as its own chapter.

**Decision.** Create a **top-level "Security & architecture" chapter** on the website (via the
`website` agent, house style; promoted in `.vitepress/config.ts` nav, not buried under Operating),
documenting the target model end to end. Grounded in ADR 0008/0009 and the code — not the stale
blue-era pages.

**Security half — the whole authority model:**
- Capabilities: single-action, proof-bound, time-boxed, bound to workload/run/attempt/args; the
  `ActionCapability` shape and issuance.
- Proof-of-possession: the DPoP/ES256 proof envelope, per-request binding, replay/expiry handling.
- Effective-authorization digest and grant-staleness rejection.
- Workload identity: KSA + audience-bound projected tokens, `TokenReview`; runtimes hold no ambient
  RBAC; the controller as sole workload mutator; the fail-closed config gate (D13).
- Trust boundaries: channel-proxy (edge, delegates all authz), artifact-service (leased writes),
  agent-controller, agent-runtime (inert). Network default-deny (Cilium, identity-bound).
- Data authority: Postgres as sole authority, per-database least-privilege credentials (D1),
  fencing/immutability triggers. The fail-closed principle throughout.

**Architecture half:**
- Target topology (apps own deployables, logic in libs, dependency direction).
- Run lifecycle: run-ingest → `RunEvent` commit-before-SSE → cursor delivery; steering absorb/defer.
- ArtifactStore CAS; Postgres authority + fresh provisioning; OpenSandbox sandbox boundary (ADR 0009).

**Also:** the three existing blue-era security pages need review/reaping as the green model replaces
them (ties to Phase G zero-residue docs). D13's *code* portion stands; its website portion is
delivered here.

---

## Decision D15 — document a comparison of our agent runtime against the researched alternatives

**Status:** DECIDED (Jente, 2026-07-19). Feeds the Phase E runtime lane
([#246](https://github.com/italanta/opencrane/issues/246)); logged now so it isn't skipped.

**Context.** OpenCrane builds its own runtime (ADR 0005) with a conformance-selected TypeScript
toolkit driving only the bounded model/tool loop. The candidates are already researched — `@openai/
agents` (primary spike), Vercel `ai` / `ToolLoopAgent` (control), AgentScope (blueprint, never a
dependency), with the outgoing OpenClaw loop as the baseline. The selection is meant to be
evidence-driven (#246, Gate L3/L4), but the **comparison itself must be written down** — our runtime +
its chosen driver measured head-to-head against the alternatives — not left as an internal pick.

**Decision.** Produce a documented comparison (an ADR appendix or the runtime design doc, referenced
from #246) of the OpenCrane-owned runtime against the researched alternatives, on the dimensions that
actually decide it:
- **Conformance** to the independently-authored target fixtures against the LiteLLM provider matrix.
- **Callback/event fidelity** — does the driver emit model/tool/approval/progress/usage/terminal
  callbacks cleanly enough for the commit-before-SSE + cursor-replay model (each `RunEvent` persisted
  before delivery)?
- **Steering** — can mid-run input be absorbed at a model-decision boundary (D-model), or does the
  loop foreclose it?
- **Reliability envelope** — retries, cancellation, replay, terminal-race behaviour.
- **Control surface** — how much of Thread/Message/Run/approval/budget we keep vs. the loop claims.
- **Multimodal / document authoring**, **license**, **cost/perf**, **exact-pin/supply-chain**.

Include the trigger already on record: if both TS toolkits fail Gate L3, the language choice reopens.
The deliverable is the evidence table + the chosen driver with its rationale, so the decision is
auditable rather than asserted.

---

## Decision D16 (FINAL ISSUE) — repo-wide docs staleness sweep + writer/reader review loop

**Status:** DECIDED (Jente, 2026-07-19). The closing docs mandate for the Phase D → G work.

**Part 1 — full staleness analysis and correction.** Audit **every** documentation Markdown file in
the repo for staleness against the target (green) product, and correct it. Scope (stack HEAD):
- `website/**` — 40 pages
- `docs/**` — 42 files (design, ADR, agents)
- other repo `*.md` — 77 (READMEs, briefs, root docs)
- **~159 `.md` total.**
Flag and fix content describing deleted/blue-era behaviour (OpenClaw, skill-registry, Zitadel-era
identity, Linkerd, per-authority Postgres split, etc.); reconcile with the decisions in this doc and
ADR 0008/0009. Ties to the Phase G zero-residue docs pass — but done proactively, not deferred.

**Part 2 — writer/reader review loop for the website.** After a writer agent rewrites each website
page, a **second agent reads it as "a junior developer with a bachelor's degree, new to and genuinely
interested in the platform"** and critiques on:
- **Clarity** — reads clearly; a newcomer can follow it.
- **Jargon** — does not over-rely on jargon; terms are introduced before use.
- **Concept coverage** — every concept is actually explained, not assumed.
- **Progression** — high-level overview first, then concept-by-concept, then advanced topics — never
  advanced-first.
- **Engagement** — is it actually interesting to read?

Writer and reader **iterate together per page** until the page passes on all five. Apply the loop to
the new D14 security & architecture chapter and to every page rewritten in Part 1. The reader's job is
the newcomer's experience, not correctness (correctness is Part 1 + the code); the writer revises to
the reader's feedback until they agree it's good.

**Part 3 — cross-link to component READMEs.** In the website docs, where a page discusses a specific
app or library, **link to that component's `README.md` on GitHub** (the per-app/per-lib READMEs from
the D-scope README pass). The app/library ↔ component mapping is in
`docs/agents/workload-ownership.json` (and the per-app `docs/agents/apps/*.md`) — _confirm the exact
mapping source the user intended._ Keeps the website conceptual while linking readers to the
authoritative source-level README for each component.

---

## D17 — handoff routing: Documentation → Claude, Implementation → Codex (with Claude review)

**Status:** DECIDED (Jente, 2026-07-19). How the D1–D16 work is split and assigned.

Split every logged to-do into two tracks:
- **Documentation track → Claude** (writes docs/comments directly).
- **Implementation track → Codex, with Claude review** (Codex implements; Claude reviews the diff).

**Documentation track (→ Claude)**

| Item | Work |
|---|---|
| D6 | Comment `ArtifactStore` / `__FilesystemArtifactStore` (invariants, why) |
| D7 | Document `apps/artifact-service` — README + inline comments + `docs/agents/apps/artifact-service.md` |
| D12 | Class comments on `ControllerAuthorityRepository` / `PrismaControllerAuthorityRepository` (consumer + intent) |
| D13 | Document `_LoadControllerAuthorityConfig` (JSDoc + website) |
| D14 | Website security & architecture chapter (whole authority model) |
| D16 | Repo-wide docs staleness sweep + writer/reader loop + README cross-links (~159 `.md`) |
| README pass | The paused per-lib/per-app README set (46 README-less libs + apps) — write against D5 final paths |
| D9 (docs half) | READMEs + why-comments across the stack |
| D15 (writeup) | The written runtime comparison (ADR appendix / design doc) |

**Implementation track (→ Codex, Claude reviews)**

| Item | Work |
|---|---|
| D1 | One Postgres server per ClusterTenant, N databases, per-database roles/secrets |
| D2 | Squash migrations to one baseline (preserve the 13 raw-SQL trigger/function blocks) |
| D3 | User-facing per-CT backup policy surface + retention wiring |
| D4 | Move all tests into `__tests__/` (import fixes) + ESLint enforcement rule |
| D5 | Split lib namespaces: operator `/server/` vs agent `/agents/` (personas first) + scope tags |
| D8 | Artifact lib (`libs/backend/server/artifacts`) quality fixes + close #270 findings (iat bound, NP test) |
| D9 (dedup half) | Extract shared utilities / better domain modelling to remove duplication |
| D10 | Refactor `if` clusters → polymorphism / validator-aspect where it clarifies the model |
| D11 | Performance analysis of every added step (benchmark + model) |
| D15 (bake-off) | The #246 conformance run / driver selection producing the evidence |

**Mixed items** are split at the track boundary: D9 (docs→Claude, dedup→Codex), D15 (writeup→Claude,
conformance run→Codex), D8 (the *review* is Claude, the *fixes* are Codex). Sequencing note from
earlier decisions still holds: **D5 (lib reorg) before D4 (test moves) and the README pass** so both
target final paths; **D1 before D11** so perf numbers reflect the target topology.

---

## Related open feedback (not yet decided)

- **A — ADR 0002 drift:** `values.yaml:12` still cites "ONE CNPG cluster per silo (ADR 0002
  decision 3)"; realigned by D1. Update the comment + ADR.
- **B — langfuse orphaned:** old path created a `langfuse` sibling DB; the per-authority split
  dropped it (no `CREATE DATABASE langfuse`, no langfuse target) while its secret-gen remains.
  Subsumed by D1 (langfuse returns as a database in the shared cluster).

## Other "over-split / duplicated resource" cases

Swept the whole Phase D stack for the same anti-pattern (N separate stateful/expensive deployables
where one shared instance would do). **Postgres is the only real case.** Everything else is either
genuinely singular-per-silo, opt-in/pre-existing, or already the correct shared-and-partitioned
design. Detail:

- **CNPG Postgres — CONFIRMED (the D1 case).** 4× `Cluster` per silo (opencrane, fleet, obot,
  litellm) = ~4 idle pods + ~80Gi PVC where 1 server suffices. Per-authority isolation is already
  enforced at the NetworkPolicy layer (`clientPodSelectors`), so the pod split buys nothing extra.
- **Corroborating inconsistency inside #268:** langfuse is wired to use the shared `opencrane` CNPG
  cluster as a **sibling database** (`langfuse.postgresql.deploy: false`,
  `existingSecret: opencrane-postgres-creds`) — i.e. #268 *already* uses the shared-server /
  multiple-databases model for langfuse, while giving obot and litellm their own clusters. The stack
  is internally inconsistent; D1 makes obot/litellm follow the model langfuse already uses. (This is
  also why the langfuse "orphan" from feedback B is subtler than it looked — its DB home is the
  shared cluster; the per-authority split is what stranded it.)
- **artifact-service — FINE, and the model to copy.** One content-addressed store on one 20Gi PVC
  per silo, logically partitioned (`sha256/ab/<digest>`), not per-authority/per-agent/per-run. This
  is exactly the "one shared instance, logical partitions" shape Postgres should revert to.
- **agent-runtime / agent-controller / channel-proxy — FINE.** Runtime = SA + NetworkPolicies only
  (no Deployment, no PVC; Jobs are per-run by design). Controller = single reconciler Deployment.
  Proxy = stateless Deployment. No idle stateful multiplication.
- **Langfuse in-cluster trio (ClickHouse/Valkey/MinIO) — NOT the anti-pattern.** ×1 per silo, OFF by
  default (`inCluster.enabled: false`), unchanged by this diff; it's Langfuse's own architecture.
- **Per-authority connection secrets — negligible.** A consequence of the Cluster split, not an
  independent footprint; Secrets carry ~no idle cost. Under D1 the cluster-`app` secrets collapse but
  the per-database role credentials are still wanted (that's the D1 credential model).
- **Net direction is otherwise toward LESS idle footprint:** the stack deletes the skill-registry
  Deployment/Service and the Zot OCI store (10Gi PVC). Postgres is the lone regression.

**Conclusion:** D1 is a targeted fix, not the tip of a systemic problem. No further topology reverts
needed; the rest of the Phase D stateful design is sound.
