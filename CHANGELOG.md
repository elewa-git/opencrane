# Changelog

What OpenCrane can **do** after each release — written in functional terms: the
capabilities, features, and behaviour changes an operator, tenant, or integrator gains,
not a restatement of commits. Versions map to git tags; dates are tag dates. Format
follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[semantic versioning](https://semver.org/).

> **Maintenance:** when a phase or track completes (or a tag is cut), the **`changelog`
> agent** (see `.claude/agents/changelog.md`, runs on Sonnet) appends a section here in
> the same work cycle. Entries describe *new/changed capability*, never raw commit
> history. No release lands without a changelog entry — see `AGENTS.md` → Planning Discipline.

## [Unreleased]

### Fixed

- **Database upgrades now run through Prisma Migrate in a dedicated Job.** The forward 0.9.3 to
  0.10.0 path accepts the exact released predecessor, applies the saved Prisma ledger once, and no
  longer requires a backup, application write pause, or automatic recovery. Deferred migration
  hardening is tracked in #699.

- **Invited users can now complete standalone registration after the first Owner has claimed the
  silo.** A verified invited identity keeps its OIDC session long enough to accept its signed link,
  while every other product route remains unavailable until that exact subject has an active
  membership in the host-selected silo.

### Added

- **Frontend developers can now exercise onboarding and chat locally without a backend or
  infrastructure stack.** Plain `npm run serve:opencrane-ui` starts one coherent browser-only
  profile for persona approval, first chat, conversations, Agent-run progress, files, approvals,
  and child Agent threads, with deterministic slow, retry, failed-run, stable manual-reconnect, and
  routed access-revocation scenarios plus Angular and native-API tripwires for missed live bindings. Build-time profile
  replacement keeps those fixtures out of production and omits backend-owned routes locally. Local
  onboarding can follow the reviewed Commander, Catalyst, Anchor, or Analyst Guardian path. Plain
  serve enters deterministic onboarding, while named archetype scripts save the chosen fixture and
  open its Agent conversation directly. The same command starts Storybook and its Playwright visual
  pass; backend-connected local development belongs to Tier 2.

- **Org admins can now model departments, teams, and projects as one hierarchy of groups.** Groups
  expose an optional parent, direct membership, and explicit `External` or `Local` authority;
  sign-in mirrors only externally managed `group:<stable Group.id>` claims, while locally curated
  membership remains under OpenCrane administration. Missing parents, hierarchy cycles, and
  attempts to delete a referenced group fail closed.

- **Administrators can now grant product capabilities to people or groups at explicit resource
  boundaries.** Grants distinguish exact from descendant coverage without inheriting group
  membership through the hierarchy, managed editors revoke only grants they own, and resource
  shares create auditable exact-recipient grants without becoming a parallel authorization model.
- **Platform developers can now add durable, transactionally admitted work without coupling product
  logic to a scheduler engine.** The engine-neutral workflow contract and scheduling kit preserve
  idempotency, cancellation, and respawn evidence, while the Absurd adapter admits a task and its
  first attempt through one parameterized, policy-bound database procedure call in the caller's
  existing transaction.

- **Users can install and run MCP servers from an OCI Image Layout ZIP.** OpenCrane accepts only MCP
  `2026-07-28`, imports the package to an immutable image digest, and executes each discovery or tool
  call in an isolated MCP-specific Kubernetes Job with a durable claim, bounded identity, and retry
  and cleanup ownership. Caller-owned public tasks save input, results, and failures across retries;
  readiness failures are recorded under the claimed command, and cancellation cannot orphan a Job
  while the controller is saving its Kubernetes identity.

- **Artifact processing and skill work can now survive worker or server restarts.** Their Absurd
  workflows claim saved work, fence every delivery, retry recoverable failures, preserve completion
  evidence, and clean up expired or replaced workload and output leases. AgentRun execution and
  terminal recovery also use Absurd; the saved AgentRun workflow now removes the exact warm Pod and
  finalizes cancellation without a separate database-polled Job cleaner.

- **Application developers can now run the real OpenCrane API, PostgreSQL, and Agent chat locally
  without a Kubernetes cluster.** `npm run dev:tier2` starts the live-gateway UI against a fixed
  local identity and target-baseline database; the optional Agent profile preserves normal run
  admission, controller assignment, runtime authentication, streaming, candidate validation, and
  persistence. Developers can choose a local LiteLLM proxy, an explicit shared HTTPS LiteLLM proxy,
  or credential-free deterministic model output while Cognee, memory, Obot, artifacts, channels,
  and Kubernetes remain explicitly disabled. The local proxy discovers reviewed
  provider credentials using `keys/.<provider>-key`:
  `--provider` selects a reviewed provider and its default model, while `--model` selects an exact
  reviewed model and its owner. Omitting both deterministically uses the default for the first
  recognized filename in sorted order. A selected model's secret-free configuration is generated
  once under the ignored local LiteLLM development directory and reused on later runs; only that
  configuration and provider key are supplied to LiteLLM.

- **Infrastructure developers can now retain and inspect a complete local Kubernetes silo after
  qualification.** `npm run dev:tier3` runs the same full-silo k3d smoke that protects `develop`,
  leaves the qualified cluster available for kubectl diagnosis, and exposes the real ingress through
  a Codespaces-compatible loopback proxy. Login establishes a fixed development identity through a
  fresh per-run proxy proof, durable Principal and Owner admission, and a bounded signed session,
  without requiring an external OIDC provider. The minimum-host profile resets disposable cluster
  and image storage and rebuilds sequentially within 32 GB; the recommended profile retains reusable
  dependencies and caches for faster repeated builds. The repository devcontainer supplies
  Docker-in-Docker and the CI-aligned Node, Helm, k3d, and kubectl toolchain, with dependency
  installation available to Codespaces prebuilds. Contributors can select the separate
  `dev:tier3:agent` profile to complete personal-agent onboarding against an exact reviewed
  provider/model. Its provider key remains outside Git, build environments, Helm values, and logs;
  the release installer publishes only the fixed custody Secret, and startup waits for the selected
  model to become the first live routing default.

- **Users and operators can now see the availability of every user-visible service through
  unauthenticated `GET /healthz`.** The fixed, public-safe report classifies the API, database,
  models, memory, files, channels, and integrations as `available`, `unavailable`, or `disabled`
  without exposing topology or failure details. Any configured-service outage reports `degraded`,
  but remains `ready: true` with HTTP 200 while the database is available; database loss or an
  unreadable report fails closed as `ready: false` with HTTP 503.

- **Operators can now identify and migrate the complete 0.10.0 workflow release as one composition.**
  Its immutable release manifest binds the application, chart, database, OCI MCP executor, and Prisma
  migrator versions, while fresh installations continue to use the reviewed target baseline.

- **Operators can now retire one standalone silo without deleting an active tenant or foreign
  resources.** The app-owned teardown requires an exact cluster context, release composition,
  tenant confirmation, and acknowledged DNS and Zitadel cleanup, then proves Helm, PostgreSQL,
  namespace, and cluster-RBAC ownership before deleting only the named silo resources. Protected
  tenants and ambiguous inventories fail closed, while interrupted retirements can be retried.

- **Operators can now admit managed agents through the immutable, fail-closed run authority.**
  Run-now and scheduled work derive a dedicated service principal, verify its current
  Ed25519-signed fleet membership, intersect the active revision's exact non-personal knowledge
  attachments with effective grants, and atomically persist the run, snapshot, and dispatch
  request. Managed Jobs use their distinct projected identity and can never inherit the requesting
  administrator, scheduler, personal memory, or personal configuration tools.

- **Platform developers can now build the personal-agent data model, APIs, and policies from one
  canonical target contract.** Pure packages define personal and managed AgentServices, immutable
  revisions and runs, ordered transcripts and events, content-addressed artifacts and skills, and
  proof-bound runtime assignments; the public contracts barrel exposes the same types without a
  second domain authority.

- **Authorization implementations can now evaluate grants and signed fleet membership with
  deterministic fail-closed rules.** Project is independent of department and team, deny wins at
  equal priority, and membership trust is bounded by verified issuer evidence, silo and subject,
  monotonic revision, maximum staleness, and hard expiry.

- **Personal-agent onboarding now has an executable persona contract before UI and runtime work
  begins.** Versioned interviews select reviewed `SOUL.md` templates, produce three to five explicit
  provenance-linked insights, and block the first session until the user previews and approves the
  compiled PersonaRevision; runtime cannot mutate durable persona content.

- **Storage and update implementations now share enforceable product invariants.** Canonical data is
  retained until authorized deletion on mounted, backed-up, online-expandable storage; runtime
  workspaces are mounted non-authoritative scratch; and future application updates must return ready
  target Pods in strictly less than five minutes while remounting existing canonical volumes.

- **Platform developers can now work on one functional capability in isolation, with module
  boundaries enforced by lint.** The server's capabilities are split into scope-tagged NX libraries
  grouped by area under `libs/backend/server/` (`agents`, `gateways`, `iam`, `knowledge`,
  `reporting`, `tenancy`) and the surrounding `libs/backend` seams, each owning its routes, services,
  types, tests, and Prisma schema slice. A module-boundary lint rule (`npm run lint:boundaries`)
  enforces that imports flow capability → allowed dependency + shared only — no cross-capability hard
  coupling. The stepping stone for multi-tenant customisation and plugin ownership.

- **The workspace now builds, tests, and lints with NX caching — `npm run build/test/lint` runs once
  per input change across every capability library.** NX derives the project graph from project
  metadata and source imports, so a new package or dependency edge updates cache invalidation without
  manual configuration. The developer experience remains `npm run build && npm test`, and CI cost
  drops as unchanged capabilities are skipped.

- **Adding a new capability library requires no Dockerfile or CI edits — the image builds the app's
  dependency closure automatically.** The Dockerfile copies `libs` wholesale and runs the
  OpenCrane server's npm workspace build, which lets Nx build the required dependency graph; each
  new library is included on the next build without touching the build definition. The `npm ci` →
  `docker build` → app-start pipeline stays identical.

- **Operators can create a silo database directly from one reviewed target definition.** Per-domain
  Prisma files keep model ownership visible, while a content-addressed immutable baseline is applied
  once during CloudNativePG `initdb` as the application owner. Server startup never changes schema,
  physical recovery reuses the schema in the backup, and a protected in-database digest prevents an
  incompatible backup from being relabelled as current. A changed target requires a clean database.

- **Org admins can supply their own upstream provider key and get a full tier-structured model
  catalog from a single credential.** Calling `PUT /api/v1/providers/byok/:provider` (org-admin
  gated) stores one raw key in a Kubernetes Secret, registers it with the silo's LiteLLM instance
  over the dynamic `/credentials` path without a restart, and seeds a catalog of flagship, balanced,
  and fast model classes — all routed through that single key. From that point, the org's tenants
  can call any of those model tiers without the platform operator having to register individual
  models. The route is `_RequireOrgAdmin`-gated; LiteLLM-only routing is the enforcement layer.

- **The gateway WebSocket is now reachable at `/gateway` so the org's SPA can own the root path.**
  Upgrading to `wss://<org>.<base>/gateway` routes to the tenant's OpenClaw pod (the proxy strips
  the prefix before forwarding). The SPA serves at `/`; the control-plane API remains at `/api/*`.
  Same-origin org ingress rules that make this layout work are folded into Helm behind
  `ingress.sameOrigin.enabled` (opt-in, default off), and the org's Control-UI origin is
  allowlisted so the gateway WebSocket handshake passes the CSWSH origin check.

- **Tenant configuration changes now propagate to the running pod without manual intervention.**
  The operator stamps `opencrane.io/config-checksum` (a SHA-256 of the canonical `openclaw.json`)
  on the pod template, so any config change — including a newly registered BYOK default model —
  triggers a rolling restart automatically. Before this, a BYOK key registration had no effect
  until the pod was manually recycled.

- **Approved agent tool calls now execute through a recoverable server-owned action boundary.**
  Runtimes submit attempt-fenced candidates without receiving provider addresses or credentials;
  OpenCrane validates the frozen tool grant, applies any approved argument edits, and assigns the
  admitted OCI image to the MCP executor. Definite results resume the run exactly once, internal
  preparation retries are bounded, and an uncertain provider outcome stops visibly for recovery
  instead of sending the action again.

- **Personal-agent runs can recall organisation and personal memory through a locked-down memory
  gateway.** A dedicated `memory-gateway` app is the only process allowed to reach the silo's
  Cognee instance: it TokenReviews the server's identity and accepts only a single bounded
  `CHUNKS` search against one caller-authorised dataset, rejecting anything else before it reaches
  Cognee. Admission-time recall freezes the selected fact references (an id and content digest,
  never raw text) into the run's input, and the compiler re-resolves and digest-verifies every
  reference before it is compiled into the run, so a redelivered run stays byte-identical or fails
  closed rather than silently drifting. Mid-run recall, writes, and correction remain unavailable
  pending a durable write lifecycle.

- **Skill authoring now runs as a durable, isolated Kubernetes Job.** The server saves a validation
  workflow with the skill change, and the agent controller creates only the pinned, restricted
  authoring Job accepted by fail-closed admission. Retries and restart recovery come from the saved
  workflow task; projected identity and an opaque bootstrap reference bind the worker to the exact
  validation without exposing source bytes or credentials in the Job.

- **Every artifact and skill now has a stable, content-addressed, versioned identity, and users
  can browse their own uploads.** Artifact bytes are stored once, addressed by their SHA-256
  content hash, and finalised into an immutable revision only after a signed, single-use
  promotion receipt is verified — a replayed or forged receipt is rejected. Skills carry the same
  stable-identity/immutable-revision shape, exposed read-only at `GET /api/v1/skills`. Users can
  list their own non-deleted assets at `GET /api/v1/me/assets`; an uploaded PDF is automatically
  converted to text by an isolated worker so its content becomes searchable, with the derived text
  kept as an immutable, lineage-linked revision.

- **API clients now get structured, per-field validation errors instead of an opaque 400.** An
  invalid request body returns bounded `{ location, path, message }` issues (capped at 20 issues,
  16 path segments deep, generic messages that never echo the rejected value) generated from the
  same Zod schema that validates the request — surfaced through `@opencrane/contracts`'s typed
  error envelope and a browser API-error helper, so a form can map each issue straight to the
  field that caused it.

### Changed

- **Operators upgrading from 0.9.0 to 0.9.3 now cut over to the same IAM model used by fresh
  installations.** The digest-bound migration deterministically projects principals, groups,
  memberships, grants, and resource boundaries, then removes the superseded agent-scope and MCP
  access-policy authorities; ambiguous or populated unsupported legacy state stops before mutation,
  and recovery remains backup/restore only.

- **Maintainers now carry durable compatibility and transition evidence with every release-affecting
  change.** Each directly changed or dependency-adapted Nx application records the immutable root
  train where its production contract was last adapted; changed charts carry a reviewed Helm
  transition, database changes carry a digest-bound SQL transition and convergence proof, and prior
  release manifests cannot be rewritten.

- **Maintainers can now navigate deployment and server ownership directly from the directory
  structure.** Deployment-only applications live under `apps/_infra`, the installation chart lives
  under `apps/_infra/deploy-k8s`, reusable OpenCrane server domains live
  under `libs/backend/server`, and server-process support lives under `libs/backend/server/infra`.

- **Operators can now identify and release every deployed workload from its owning app package.**
  OpenCrane server and UI definitions stay with their product apps; Cognee, LiteLLM, and Obot live
  under `apps/_infra`; and `apps/_infra/deploy-k8s` composes those app-owned charts.

- **Platform developers can reuse functional server capabilities without importing an app root.**
  Tenant reconciliation, identity, projection, connection auth, policy reconciliation, channel
  proxying, tenant hosting, transport security, and OpenAPI ownership now live in focused backend
  and infrastructure libraries. CI rejects new app-owned implementation logic, unregistered
  workload constructors, duplicate workload ownership, and dependency-direction drift.

- **Tenant runtime upgrades and rollbacks are now image operations, not startup-time mutations.**
  OpenClaw and its Cognee memory plugin are pinned in the tenant image, and an empty state volume
  can start either the current or previous image without downloading executable code. Operators
  can now qualify and roll back the exact runtime artifact they deploy.

- **Tenant MCP access now has one effective authority path.** AccessPolicy and the rendered runtime
  contract determine which servers are available; retired Tenant-CRD allow/deny fields, shared-skill
  mounts, and free-form runtime overrides can no longer shadow that decision.

- **Tenant-runtime org memory now has one implementation and ownership boundary.** The official
  Cognee OpenClaw plugin exclusively owns retrieval and capture; the retired bespoke awareness SDK
  and its dead bootstrap version marker are removed. Existing server-side rollout controls are
  unchanged pending a separate retirement or migration to real plugin deployment versions.

- **The identity and mesh substrate decision has moved from Linkerd to Cilium + SPIFFE.**
  ADR 0003 — Cilium + SPIFFE identity substrate — supersedes ADR 0001 (Linkerd). The chosen model
  gives every silo workload a SPIFFE SVID (`spiffe://opencrane/ct/<org>/<workload>`) derived from
  its Kubernetes ServiceAccount, and enforces the default-deny + allow-intra-silo + allow-super-admin
  posture at L3/L4/L7 via `CiliumNetworkPolicy` keyed on cryptographic identity rather than IP
  addresses. The portable `NetworkPolicy` floor from S2 remains as defence-in-depth underneath.
  This is a recorded architectural decision; Cilium + SPIFFE enforcement is forward implementation
  work (tracked in S5).

### Fixed

- **Operators now have a bounded recovery path for standalone invitation upgrades that stalled
  before the `0.9.0` database migration.** The `0.9.1` repair creates the invitation-signing Secret
  before the server write fence, carries forward only the exact digest-bound `0.8.1` to `0.9.0`
  migration, and rejects altered, undeclared, skipped, or multi-hop sources. For this specifically
  approved repair, operators may explicitly skip unavailable physical-backup creation with
  `--allow-unbacked-database-migration`; source classification, the write fence, transactional
  migration, convergence and privilege checks, and post-failure recovery remain mandatory. A
  database whose migration already completed can now finish convergence and privilege
  reconciliation because the proof query binds its validated history values through psql's script
  input instead of treating them as literal placeholders, allowing the fence to clear. Deployments
  that omit `--initial-model-provider` can also complete Helm argument construction under strict
  shell checks instead of aborting on an unset optional argument array. The path is contract-tested;
  live-cluster redeployment qualification remains pending.

- **BYOK model calls no longer return 401 when the operator fetches the tenant model list.**
  The `/api/internal/*` routes (`/tenant-models`, `/bundles`, `/contract`,
  `/awareness/participation`) are now mounted before the browser-session auth middleware, so the
  tokenless operator hot-path fetch and TokenReview pod-identity routes receive the NetworkPolicy
  gate they are designed for rather than being blocked by the session gate. Previously, BYOK-routed
  model calls were bricked because the operator's `/tenant-models` fetch was 401'd before it could
  register the virtual key. A separate hardening step — serving `/api/internal` on a dedicated
  port 8081 off the public ingress — is in progress on branch `fix/internal-api-separate-listener`
  but is not yet merged to `main`.

- **Per-org OIDC is now enforced and fully derived at deploy time.** When `OIDC_ISSUER_URL` is
  set, the silo deploy script requires `OIDC_CLIENT_ID` and derives the correct per-org callback
  URL (`https://<org>.<base>/api/v1/auth/callback`) when it is not provided. This closes a gap
  where a silo could be deployed with an incomplete or mismatched OIDC configuration.

- **`/auth/pod-token` now resolves correctly for all tenants.** The silo operator projects each
  Tenant's `status.ingressHost` into the database record, so the pod-token broker can resolve the
  target pod address from the DB without an additional CR lookup. Previously the host was absent
  from the DB and pod-token resolution could fail for tenants that had not gone through a
  post-split reconcile cycle.

- **Listing or resolving a share can no longer widen what a row exposes, or guess at an
  unrecognised scope.** Share reads now select only the fields declared in the public sharing
  contract rather than the full underlying row, and mapping a stored scope value that doesn't
  match one of the four supported kinds (org, department, project, personal) now fails closed
  instead of silently defaulting to `personal`.

### Security

- **Tenant pods can no longer self-install or self-update their agent runtime.** Runtime code is
  owned by the signed image lifecycle, closing the path where a restart or mutable state volume
  could silently select a different OpenClaw or memory-plugin build.

- **The Control-UI can authenticate users over trusted-proxy without requiring device pairing.**
  Setting `dangerouslyDisableDeviceAuth: true` on a gateway lets a Control-UI connection that
  arrives over the OIDC-verifying ingress proxy retain full operator scopes — without the
  OpenClaw device-pairing handshake that would otherwise strip them and cause chat RPCs to fail
  with a missing-scope error. The safety argument is structural: the gateway is only reachable
  through the trusted-proxy ingress (which has already verified the OIDC session), and the
  `allowUsers` pin on the gateway restricts it to the tenant owner's email. Device auth is
  redundant in this topology; the flag makes that explicit rather than leaving it as a silent
  gap.

- **Product and domain repositories can no longer run raw SQL against the database.**
  `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, and `$executeRawUnsafe` are forbidden in those
  production adapters, and no temporary policy exemption can reopen them. Two checked workflow
  adapters are the narrow exception: they call the fixed, parameterized `absurd.spawn_task` and
  `absurd.emit_task_event` procedures that admit work and save task events in a database transaction.

### Removed

- **Operators no longer deploy or maintain Obot or MCPB alongside the supported MCP runtime.** The
  Obot workload, integration authority, MCPB upload and validation surfaces, and replaced SQL
  pollers, locks, and outbox kinds are removed after their OCI and Absurd owners take over.

- **Operators can now run the OpenCrane stack without the bundled Langfuse data plane.** The
  Langfuse workloads, database and credentials, LiteLLM callback, metrics proxy, and unused
  dashboard are gone.

- **OpenCrane now has one supported product surface: authenticated APIs, generated clients, and
  the UI.** The bundled `oc` command-line app and its active documentation are removed, eliminating
  a second client that had to duplicate every API and workflow change.

- **Legacy pairing, brokered-device, and live SessionScope contracts are retired.** Tenant cuts now
  terminate the single-user runtime pod directly, and the obsolete session-scope CRUD/API/client
  surface is gone. Historical SessionScope rows remain only as migration input for the green
  platform cutover.

## [0.9.0] - 2026-08-18

### Added

- **Organisation admins can now invite members from Settings on a standalone silo without Fleet or
  a payment service.** They can view the member directory, create or refresh expiring shareable
  links, and admit a signed-in recipient only after an exact verified-email match; rotated, expired,
  replayed, wrong-email, and wrong-silo links fail closed. Fleet-backed deployments can instead
  delegate the same journey to a configured membership-and-billing gateway, whose failure never
  falls back to local writes; Fleet's receiver-side billing remains unshipped.

## [0.6.1] — 2026-06-29

Post-split operability fixes: fleet manager exposed, multi-silo RBAC coexistence, and chart
housekeeping that makes a two-chart (fleet + silo) install converge cleanly.

### Added

- **The fleet-manager's `/auth/*` endpoints are now documented in its OpenAPI specification and
  typed client.** `@opencrane/contracts` ships a regenerated fleet API client that covers the
  authentication routes alongside the fleet-management paths, so integrators get compile-time
  safety for the full fleet surface. CI now fails any PR that ships a stale generated spec or
  client.

### Changed

- **The fleet-manager is now reachable over the cluster ingress.** A Service and Ingress are
  provisioned for the fleet-manager, and `PLATFORM_BASE_DOMAIN` is wired into the deployment,
  so the `oc` CLI can address the fleet manager at its own host without port-forwarding. The
  fleet ingress routes `/api` and `/auth` to the fleet-manager and leaves `/` for the frontend.

- **Multiple silos can now coexist on one cluster without RBAC conflicts.** Cluster-scoped RBAC
  objects (ClusterRole, ClusterRoleBinding) are suffixed with the ClusterTenant name, so each
  silo install creates distinct RBAC objects rather than overwriting those from a previous silo.

- **Silo namespaces run under PSA `baseline` (not `restricted`).** The Pod Security Admission
  label is corrected to the tier the silo's workloads actually satisfy, removing spurious
  admission rejections that could prevent pods from scheduling. The control-plane is served at
  the org host as intended.

- **The `skillAllowlist` field and `OPENCRANE_ALLOWED_SKILLS` env var are removed.** The dead
  code path was superseded by the grant-compiler skill-entitlement model; removing it eliminates
  a stale configuration surface that had no effect on enforcement.

- **Helm subchart dependencies for silo and fleet charts are now reproducible.** Dependencies
  are resolved from `Chart.lock` via `helm dep build` (not `dep update`), versions are pinned
  exactly, and the k8s-platform substrate lib is excluded from the chart archive via
  `.helmignore`. Upgrades are now deliberate, not implicit.

## [0.6.0] — 2026-06-29

Stage 4 "strong-siloes" fleet/silo architecture split plus earlier silo-program identity work.

### Added (Stage 4 — fleet/silo split)

- **The platform is now governed by two purpose-built managers — one fleet-wide, one per-silo —
  so the super-admin plane and the tenant-facing plane can never bleed scope into each other.**
  The former `operator` is renamed `fleet-manager`: it is the cluster-wide singleton that owns
  ClusterTenant lifecycle, billing accounts, org membership, platform DNS, and the Zitadel admin
  credential. The former `control-plane` is renamed `clustertenant-manager`: it is deployed once
  per silo (one per ClusterTenant) and serves only tenant-facing routes (tenants, policies,
  groups, skills, model routing, shares, awareness, sessions). Neither binary can serve the other's
  routes — an unrecognised role crashes at boot, so a misconfigured deploy fails loud.

- **Fleet operations are reachable at a dedicated fleet endpoint, distinct from any silo.**
  The `oc` CLI reads `--fleet-url` / `OPENCRANE_FLEET_URL` (falls back to `--url` for
  co-located single-host dev) and routes all `cluster-tenant`, `admin zitadel`, and
  `platform dns` commands there. In a production topology, platform operators point the CLI at
  the fleet-manager; tenant operators point it at their silo — and neither can accidentally hit
  the wrong plane.

- **The fleet-manager has its own OpenAPI specification and typed client.**  `GET /api/v1/openapi.json`
  on the fleet-manager returns its own spec covering the 11 fleet paths. `@opencrane/contracts`
  now ships two typed clients — `___CreateFleetClient` and the existing silo client — so
  integrators can depend on exactly the surface they need and get compile-time safety for both.

- **Shared server infrastructure code is extracted into two workspace libs usable by both managers.**
  `@opencrane/server/_infra/api` provides CRD constants and typed Kubernetes error helpers.
  `@opencrane/server/_infra/auth` provides the shared OIDC login/auth substrate — `OidcAuthServiceBase`,
  auth middleware, org-membership helpers, and the gating primitives — parametrised over each
  manager's Prisma client so neither app ships a duplicate copy of the auth stack.

- **Each org's OIDC login now resolves from the cluster-scoped ClusterTenant CR, not a silo
  database row.** When a user hits a silo at `<org>.<base>`, the silo reads the ClusterTenant
  CR (keyed by host label or `spec.vanityDomain`) to find the correct Zitadel `client_id` and
  org scope — the CR is the single source of truth, written by the fleet and readable by any
  silo. The previous per-silo database lookup is gone, so a silo never holds a stale or
  diverged copy of IdP routing data.

- **The fleet projects each org's public Zitadel identifiers onto the ClusterTenant CR** so that
  silos can resolve per-org login without access to the fleet registry database. The fleet writes
  the org's Zitadel organisation ID, project ID, and OIDC client ID onto `spec` at provision
  time and keeps them current on reconcile.

- **A new org's first workspace is seeded automatically by the fleet operator, not the silo.**
  When a ClusterTenant CR transitions to `ready`, the fleet operator writes the `<org>-default`
  Tenant CRD directly into the bound namespace — owner identity is carried on `spec.owner`.
  The silo TenantOperator then reconciles it into a running openclaw pod. Seeding is idempotent
  and fail-soft: a transient error retries on the next reconcile without wedging the org.

- **The silo periodically repairs its Tenant projection to stay in sync with CRDs.**  A
  background `TenantProjectionRepairer` loop (default interval: 60 s; set
  `OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS=0` to disable) diffs the silo's Postgres
  Tenant rows against the namespace's Tenant CRDs and upserts any missing entries. This ensures
  fleet-seeded workspaces surface in the silo's management API (e.g. `oc tenant list`) without
  requiring the silo to watch the fleet write-path.

- **The silo schema no longer carries fleet-owned tables.** Migration `0030` drops the silo's
  `cluster_tenants` and `billing_accounts` tables along with their enums; `OrgMembership` retains
  a soft string reference to the ClusterTenant name (no cascade FK) as a local read-model for
  `/auth/me` and the org-admin gate. The fleet-manager is now the sole owner of the fleet
  registry.

### Changed (Stage 4 — fleet/silo split)

- **The Zitadel management credential, key-rotation RBAC, and platform-DNS RBAC all move to the
  fleet-manager service account.** The silo's ClusterRole for `clustertenants` is reduced to
  read-only (needed only for per-org login CR reads). The Helm values key for the self-service
  flag is renamed `clusterTenantManagement.enabled` (was `clusterTenantManager.enabled`) to
  disambiguate it from the `clustertenantManager` component key; fleet-specific OIDC is under
  `fleetManager.oidc` and fleet-specific Zitadel config under `fleetManager.zitadel`.

### Added

- **Every agent now acts with its user's full entitlements — not a flat tenant identity.** An
  openclaw Tenant is bound to a specific OIDC user (the new `Tenant.subject` field); when the
  contract is compiled the grant compiler expands `{tenant-name, user-subject, groups(subject)}`
  so the agent inherits the same group memberships, skill entitlements, and MCP access-policy
  decisions as the human behind it. Previously the compiler was keyed on the tenant name alone,
  so user-level group grants never reached the agent. The contract poll and hot-reload are
  unchanged — the capability propagates without a pod restart.

- **An agent's Cognee dataset memberships are now derived automatically from the user's groups
  and grants.** On every contract poll the control plane expands the user's principal-set, diffs
  the result against the current memberships, and applies only the delta to Cognee — so
  dataset access converges to the correct set without any manual `_ApplyTenantDatasetMembership`
  call. The diff is dup-safe (no re-add on unchanged memberships) and scoped across
  Org/Department/Team/Project/Personal tiers.

- **Dataset-scope vocabulary is kept consistent between the grant system and Cognee.** A new
  sync pass ensures the `DatasetScope` labels used in grants match those used when declaring
  Cognee datasets, so the compiler's expansion produces the same scope identifiers that Cognee
  dataset membership checks expect — closing a silent mis-match that caused group grants to
  expand but not reach the right datasets.

- **Users can share tools and skills with other users or groups via `oc share`.** Calling
  `oc share grant --to <user|group> <resource>` writes a `Grant(subject=User|Group, Allow)`
  bounded by least-privilege (a caller cannot share more than they themselves hold — no
  privilege escalation). Revoking with `oc share revoke` removes the grant; the existing
  compile→poll→reload loop propagates both changes to every affected agent without a restart.

- **Sharing a file or chat creates a resource group that other users can be granted access to.**
  `oc share resource` associates a file or chat artefact with a named resource group; a caller
  with access to the group automatically gains access to everything inside it via the grant
  compiler, and the group membership is derived into Cognee dataset memberships on the next
  contract poll. The resource-group model extends the existing grant vocabulary with no new
  enforcement surface.

- **Each organisation's users log in through a fully isolated Zitadel Organisation — provisioned
  automatically when the org is created.** On `POST /cluster-tenants` the control plane provisions
  a dedicated Zitadel Organization, project, roles, and OIDC application for that org, and
  registers the org's callback URI (`<org>.<base>/api/v1/auth/callback`) so login works
  immediately at the org's host. The provisioning is transactional: Zitadel is called as the
  last step inside the Prisma transaction so the database never commits without a matching IdP
  object. Deleting the org tears down the Zitadel Organisation, roles, and redirect URI in the
  same pattern — no orphaned IdP objects.

- **Login at an org's host resolves to that org's OIDC client automatically.** The control
  plane now maintains a per-org client registry (keyed on `<org>.<base>`); each request host
  is resolved to the matching OIDC `client_id` and Zitadel org scope so only that org's user
  pool can authenticate. The masters / control-plane host continues to use the platform-level
  client. The previous single-client model that reused one redirect URI for all hosts is replaced.

- **A customer's vanity domain is registered as a valid redirect URI in Zitadel automatically.**
  When a `vanityDomain` is set on a ClusterTenant, the control plane adds the vanity host's
  callback to the org's Zitadel OIDC application alongside the canonical `<org>.<base>` URI —
  so users who reach the org via a custom CNAME can log in without a manual console step.

- **Each silo namespace gets a default-deny network baseline on provision.** The operator emits
  a `NetworkPolicy` for every ClusterTenant namespace that denies all ingress and egress by
  default, then selectively allows intra-silo traffic, control-plane/operator reach, DNS (UDP 53),
  and external HTTPS (TCP 443). No rule names another silo — east-west default-deny is structural,
  not a configuration option. The misplaced install-namespace policy that previously provided no
  real isolation is removed.

- **The trusted-proxy CIDR is derived from the operator's own pod IP when configured with
  `[auto]`.** Instead of requiring operators to look up and hard-code the ingress-nginx pod CIDR,
  setting `tenant.gateway.trustedProxies: ["[auto]"]` causes the operator to read its own pod
  IP from the downward API and derive a `/14` allowlist. The `[auto]` path still fails closed
  (an unresolvable pod IP stays trust-nothing) and the CONN.9 default remains an empty allowlist
  (trust nothing) — `[auto]` is opt-in only.

- **Platform operators can rotate the master Zitadel service-account key with a safety
  guarantee — the live key only changes after the candidate is proven working.** Calling
  `oc admin zitadel rotate-key` (or `POST /api/v1/admin/zitadel/sa-key:rotate`) validates
  the candidate key in full before touching anything live: it exchanges the candidate for a
  short-lived token and then probes for `IAM_OWNER` on the Zitadel instance. Only when both
  checks pass does the rotation proceed — the new key is written to the Kubernetes Secret
  first (so a pod restart keeps it), then swapped in-memory with the token cache cleared.
  If validation fails the endpoint returns `422` with per-check flags (`tokenExchangeOk` /
  `instanceScopeOk`) and the old key remains active. Key material is accepted on stdin, via
  `--key-file`, or inline; it is never echoed or logged. The route is platform-operator
  gated and the Helm RBAC is tightly scoped to patch-only on the single named Secret.

- **Org administrators can manage who belongs to their organisation — and the last owner
  can never be accidentally removed.** The `oc cluster-tenant members` sub-commands
  (`list`, `add`, `remove`) and the underlying
  `GET / POST / DELETE /api/v1/cluster-tenants/:name/members` endpoints let an org manager
  list current members, upsert a member at a given role (Owner / Admin / Member), and
  remove a member. A last-Owner guardrail enforces that demoting or removing the sole Owner
  returns `409 LAST_OWNER`, so an organisation can never be left without an owner. Access
  is gated on the org-manager role; no Zitadel call is made in this slice — membership is
  held in the platform database and read by the org-admin gate on every request.

- **Each silo can optionally enforce cryptographic workload identity between its services —
  layered on top of the existing L3/4 network baseline.** When `linkerd.meshEnabled` is set
  to `true` in Helm (default off), the operator annotates the silo namespace for Linkerd
  injection and emits a per-silo deny-by-default `Server` + `MeshTLSAuthentication` +
  `AuthorizationPolicy` that allows intra-silo and operator-namespace mTLS traffic while
  denying cross-silo communication at the identity layer. The policy is the mesh-layer
  analogue of the S2 `NetworkPolicy` baseline — both must be satisfied. Fail-closed: on a
  cluster without Linkerd CRDs installed the step is logged as skipped and the silo remains
  fully L3/4-isolated; no error, no partial state. This is the first slice of S5; SPIFFE
  workload-identity issuance and the super-admin identity loop are follow-on slices.

- **Each ClusterTenant runs as a fully self-contained silo — its own operator, planes, and
  database — on shared nodes, with the central control-plane as the only component that crosses
  silo boundaries.** Rather than multiplexing all tenants through shared singleton instances of
  Obot, LiteLLM, Cognee, and the skill-registry (where isolation depends entirely on each
  plane's app-level ACL being correct), each ClusterTenant now gets dedicated instances of every
  runtime plane plus its own operator and its own CNPG Postgres database. The central
  super-admin control-plane in `opencrane-system` (and Zitadel) remain the sole shared
  components and act only on named ClusterTenants — never on caller-inferred tenant identity.
  A silo control-plane therefore never has to guess which tenant a request belongs to: the silo
  is the scope. This retires the resolution-ambiguity class (the recurring family of
  default-tenant-projection and cross-tenant-lookup bugs) by construction, without a code shim.
  All dedicated stacks run on shared cluster nodes; dedicated-node and dedicated-cluster
  scheduling tiers are a future upgrade layered on this topology.

- **Operators deploy the central super-admin control-plane and each per-ClusterTenant silo
  independently, from source, with two purpose-built scripts.** `./platform/deploy-multi-tenant.sh`
  installs the cluster-wide infrastructure (ingress-nginx, CloudNativePG operator, cert-manager,
  external-dns) and the central control-plane (`deploymentRole=central`) that manages the fleet,
  provisions ClusterTenants, and runs Zitadel — but serves no tenant-facing API. Once the central
  release is up, `./platform/deploy-silo.sh --base-domain <domain> --cluster-tenant <name>`
  installs one silo into `opencrane-<name>`: its own operator, runtime planes, and a per-CT CNPG
  database in that namespace, with `deploymentRole=silo`. The silo script reuses the
  cluster-wide infra already present (`--no-ingress-nginx`, `--no-external-dns`,
  `--no-db-operator` are set automatically) and fails fast with a clear message if the central
  release has not been installed first. Additional silos are added by running the silo script
  again with a different `--cluster-tenant` value.

- **The control-plane image mounts only the API routes that belong to its deployed role.**
  Setting `OPENCRANE_CONTROL_PLANE_ROLE=central` (the default; also set via Helm
  `deploymentRole`) mounts fleet, ClusterTenant-lifecycle, Zitadel, and platform-DNS routes and
  suppresses every tenant-facing route. Setting `deploymentRole=silo` mounts tenant-facing
  routes (tenants, policies, groups, skills, model routing, shares, awareness, sessions) and
  suppresses every fleet/cross-silo route. An unrecognised value crashes at boot with the
  offending value named, so a misconfigured topology fails loud rather than silently presenting
  a partial API surface.

### Security

- **The platform gateway block in every tenant config is now pinned against `configOverrides`
  clobber.** A shallow merge of `configOverrides` could previously replace the entire `gateway`
  block, silently dropping the owner `allowUsers` pin and any crashing-key guard. The operator
  now renders the gateway block in a way that `configOverrides` cannot overwrite it, so the
  cross-tenant ownership check is structurally preserved regardless of what a tenant's overlay
  supplies.

## [0.5.3] — 2026-06-23

Tenant operator stability: eliminates the status-write hot-loop that inflated ResourceQuota usage and blocked workspace provisioning under high tenant counts.

### Added

- **Signing out via the API now ends the IdP session, not just the local cookie.** `POST /auth/logout` calls Zitadel's `end_session_endpoint` so the user's token is invalidated at the identity provider — a subsequent sign-in requires a fresh Zitadel authentication rather than silently reusing the existing IdP session.

### Fixed

- **The TenantOperator no longer re-reconciles tenants whose spec has not changed.** A generation guard prevents the operator from re-entering the reconcile path when a tenant is already `Running` at the current spec generation. This eliminates the status-write → watch-event hot-loop that was inflating `ResourceQuota` usage and causing `OOMKill` under high tenant counts.

- **Re-reconciling an existing tenant no longer hits `ResourceQuota` admission on the PVC.** The operator now reads a PVC before attempting to create it, so a reconcile of a tenant that already has a volume skips the create entirely — the previous blind create was refused by `ResourceQuota` admission and wedged the reconcile loop.

## [0.5.2] — 2026-06-23

Operator stability and the register→provision→ready→workspace pipeline made fully operational.

### Fixed

- **The ClusterTenant operator no longer crash-loops under watch-reconnect storms.** On every
  watch reconnect, the Kubernetes API replays all CRs as `ADDED` concurrently; without a guard,
  reconcile handlers pile up faster than they drain under API-server throttling (429s), exhausting
  memory and landing in `OOMKilled`. Two structural fixes close this permanently: a
  generation/`observedGeneration` guard makes a watch-replay of an unchanged, already-ready org a
  cheap no-op (no namespace re-create, no domain re-provision); and per-org reconcile coalescing
  serialises work to one active reconcile per org with a single coalesced pending slot, so no
  matter how many concurrent events arrive the in-flight count stays bounded. The operator memory
  limit was also raised as a safety margin.

- **The ClusterTenant reconciler can now actually provision isolation boundaries.** The operator's
  `ClusterRole` was missing the cluster-scoped grants it needs to create each org's bound namespace
  (`namespaces`) and to stamp quota and limit objects (`resourcequotas`, `limitranges`) inside it.
  Without those grants every reconcile 403'd on `createNamespace` and no org ever reached `ready`.
  The RBAC is now present and the reconciler drives the full namespace + quota + LimitRange
  provisioning path.

- **The first workspace is now seeded automatically when an org reaches ready.** The operator
  creates the org's `<org>-default` Tenant as soon as its ClusterTenant CR transitions to `ready`,
  attributing it to the owner identity stamped on the CR by the control plane at org-create time.
  Owner identity is now carried as a validated `spec.owner` field (with the legacy
  `opencrane.io/owner-email` annotation kept as a rollout fallback for CRs created by older control
  plane versions). The seed is idempotent and fail-soft — a transient error logs and retries on the
  next reconcile rather than wedging the org out of `ready`.

- **Provisioning status now advances past `pending`.** `GET /cluster-tenants/:name` and
  `GET /cluster-tenants/:name/status` now read the operator's observed phase directly from the
  ClusterTenant CR and overlay it onto the response. The DB `phase` column is desired-state-only
  and never receives the operator's write-back, so without this overlay onboarding polling was
  stuck at `pending` regardless of what the operator had done. The CR phase is also mirrored
  back into the DB as a best-effort read-repair (fire-and-forget, non-blocking) so fleet list
  views converge over time.

- **`POST /cluster-tenants` returns `409 CONFLICT` on a duplicate org name instead of a raw 500.**
  A duplicate submission now receives a clean `{ code: "CONFLICT", error: "A workspace with this
  name already exists." }` response. The global error handler is also hardened: `detail` is stripped
  from all 500 responses in production so Prisma messages and stack traces can never reach a client,
  and any unmapped Prisma `P2002` unique-constraint violation that escapes route-level handling is
  caught globally and returns a clean 409 rather than a 500.

- **Vanity-domain TLS now issues correctly via HTTP-01.** The cluster issuer previously had no
  HTTP-01 solver, so per-org vanity cert requests (for a customer-CNAMEd domain the platform does
  not control in DNS) stalled. The issuer now carries a catch-all HTTP-01 solver alongside the
  platform DNS-01 solver, cert-manager routes each request to the appropriate solver, and the
  platform wildcard's apex SAN is opt-in (`certManager.includeApex=true`) so installs where the
  bare domain is served elsewhere do not stall issuance. The GCP CloudDNS provider reference is
  also corrected (`cloudDNS:` key) so DNS-01 challenges no longer fail with an unknown-provider
  error.

- **Terraform provisions the DNS-writer service account independently of the app deploy.** The
  shared GSA (`roles/dns.admin` + Workload-Identity bindings) that cert-manager DNS-01 and
  external-dns use was previously gated on `enable_app_deploy`, so a cluster-only Terraform apply
  never created it. The DNS module now provisions the zone and the GSA unconditionally (when
  `enable_cloud_dns=true`) and defers only the install-time A-records until the ingress IP is
  known — so cert-manager DNS-01 has its credential on the first cluster apply, before any Helm
  deploy.

- **The k3d end-to-end smoke test runs cleanly again.** The Prisma migration pre-install Hook Job
  introduced in 0.5.1 pulls the control-plane image, which is not built or imported in the k3d
  smoke test (that test runs the operator only, with the control-plane at `replicas: 0`). The hook
  sat in `ImagePullBackOff`, blocking `helm install` indefinitely. The k3d values overlay now
  disables `controlPlane.migrationJob`, matching the intent of `replicas: 0`.

## [0.5.1] — 2026-06-23

Dev-cluster reliability: database migrations, LiteLLM persistence, and GKE autoscaler unblocked.

### Fixed

- **Database schema migrations now run on every `helm upgrade`, not only on pod recreation.**
  Previously the control plane ran migrations only from its init-container, which fires solely on
  pod (re)creation. A `helm upgrade` with unchanged control-plane values never rolled the pod, so
  migrations fell behind silently whenever the database was recreated under a live pod (e.g. a CNPG
  cluster rebuild) — surfacing as "table public.tenants does not exist". A pre-install /
  pre-upgrade Helm hook Job now runs `prisma migrate deploy` on every deploy, blocking the rollout
  until the schema is reconciled. The init-container remains as a belt-and-suspenders guard.
  Disable per-environment with `controlPlane.migrationJob.enabled: false`.

- **LiteLLM runtime model storage works correctly on GKE.** The previous fix that disabled
  `DATABASE_URL` broke runtime model persistence entirely. The root cause was image-specific: the
  default `ghcr.io/berriai/litellm` image (Chainguard/wolfi base) generates its Prisma query engine
  at runtime, fetches the wrong OpenSSL variant on wolfi, and crashes with `NotConnectedError`. The
  chart now uses `ghcr.io/berriai/litellm-non_root`, which ships pre-generated engine binaries and
  runs as non-root — resolving the crash without disabling the database.

- **GKE cluster-autoscaler can now scale down database nodes.** CNPG manages its instance pods
  as bare Pods (not a controller-backed workload), which the GKE autoscaler refuses to evict by
  default. The CNPG Cluster spec now sets
  `cluster-autoscaler.kubernetes.io/safe-to-evict: "true"` via `inheritedMetadata.annotations`,
  propagating onto the managed pods so the autoscaler can drain underutilised nodes.

## [0.5.0] — 2026-06-22

Per-org domain serving, the full multi-tenant deploy pipeline, and the identity-routing gateway proxy.

### Added

- **Identity-routing gateway proxy: serve a whole org's users from one host, with auth and
  anti-CSWSH controls.** A new `gateway-proxy` service (off by default; enable with
  `gatewayProxy.enabled` once an org is cut over) lets every user in an org reach their own
  OpenClaw gateway through the org's **single host** instead of a per-user subdomain. On each
  gateway WebSocket upgrade the proxy (1) checks the browser `Origin` against an exact allowlist
  and refuses anything else — the only server-side defence against Cross-Site WebSocket Hijacking,
  which CORS does not cover, and it fails closed (empty allowlist refuses all); (2) asks the
  control plane *who* the socket belongs to and *where* it goes via the new
  `GET /api/v1/auth/gateway-resolve` endpoint, which resolves the target from the IdP-verified
  email with the same fail-closed rule as `/pod-token` (no/ambiguous tenant → 403); (3) rate-limits
  per identity; then (4) forwards to that user's pod. The proxy holds no session state or secrets —
  the control plane stays the sole auth authority. Combined with per-pod owner pinning (CONN.10),
  cross-tenant safety now has two independent layers (routing + pod), either of which is sufficient.

- **Seed the first platform operator of a fresh cluster by email — no IdP group mapping
  required yet.** Set the per-cluster install parameter
  `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL` (the install wizard prompts for it; or
  `./platform/k8s-deploy.sh --platform-operator-seed-email …`, or the Helm value
  `controlPlane.oidc.platformOperatorSeedEmail`) and the person who signs in with that
  **verified** email is treated as a platform operator. This is additive to the existing
  group-based check (seed *or* group grants operator) and is meant as a bootstrap: once a
  group mapping exists in the IdP, remove the seed. It is fail-closed — an empty/unset
  seed grants operator to nobody, and an email the IdP marks unverified never matches.

- **Any signed-in user can create an organisation and instantly becomes its root admin.**
  A user first creates a billing account (`POST /api/v1/billing-accounts`), then creating a
  ClusterTenant (`POST /api/v1/cluster-tenants`) records them as the org's single `owner` in the
  same transaction — so an organisation always has exactly one root admin. `isOrgAdmin` and the
  caller's owned/administered orgs are now derived from real per-org `OrgMembership` (not a global
  flag) and surface on `/auth/me` as `ownedOrgs`. The cluster-tenants API is no longer unguarded:
  creating requires an authenticated session **with** a billing account (not pre-existing admin — a
  user becomes admin *by* creating); reading and destructive operations require a platform operator
  or an owner/admin member of that specific org. Anonymous callers are rejected (401) in any real
  deployment.

- **One fixed platform domain serves every org and user — no customer DNS delegation required.** The
  platform now owns a single wildcard base (`ingress.domain`, e.g. `weownai.eu`) and a fixed
  super-operator/control-plane host (`ingress.controlPlaneHost`, default `platform.<base>`). Each
  organisation is automatically reachable at `<org>.<base>` (e.g. `acme.weownai.eu`) and each user at
  `<user>.<org>.<base>` (e.g. `mike.acme.weownai.eu`) — derived names, created with zero per-name DNS
  work once the org's wildcard exists. A customer who wants their own brand adds a single `CNAME` from
  their domain onto `<org>.<base>` and sets the org's `vanityDomain` (`oc cluster-tenant update <org>
  --vanity-domain …`); OpenCrane adds it to the org's TLS so it is browser-trusted, while the canonical
  `<org>.<base>` keeps working.
- **TLS now covers the full two-level hierarchy.** The chart issues the platform wildcard certificate
  (`*.<base>` + apex + control-plane host) at install, and each org gets its own `*.<org>.<base>`
  certificate at provision time (cert-manager DNS-01) — because a single wildcard cannot reach the
  per-user `<user>.<org>.<base>` level. New users under an existing org get HTTPS automatically.
- **Per-org domain serving + TLS is now actually provisioned, not just specified.** OpenCrane carries a
  working `OrgDomainProvisioner` that, for a given org, applies the per-org wildcard `Certificate`
  (`*.<org>.<base>` + the org apex, plus any vanity domain) through cert-manager and declares the
  matching `*.<org>.<base>` / `<org>.<base>` A records (pointing at the cluster ingress IP) as a
  namespaced external-dns `DNSEndpoint` custom resource (`externaldns.k8s.io/v1alpha1`) in the org's
  bound namespace — so every user under the org both resolves and is browser-trusted with no per-user
  setup. The operator talks to no cloud DNS API and carries no cloud SDK: the cluster's external-dns
  controller reconciles the declared records into whatever DNS provider the platform runs (Cloud DNS,
  Route53, Cloudflare, RFC2136, …). It is idempotent and fail-closed: on a cluster without cert-manager
  it records the cert step as skipped with a clear reason and lets the org still reach ready — the
  namespace boundary, not the cert, gates attachment — instead of failing the reconcile; likewise an
  absent `DNSEndpoint` CRD (external-dns not installed) makes the DNS step report skipped rather than
  crash, and the A-record step runs only when an ingress IP target is set. This runs only from the
  operator's org reconciler — creating an org over the API never touches DNS or cert-manager directly.
- **Bring up a fresh cluster end-to-end with one command, in the profile you need.** Two thin profile
  scripts over a shared install core install everything: `./platform/deploy-single-tenant.sh
  --base-domain … --org-name … --org-owner-email …` stands up one organisation (self-service org creation
  and billing off), and `./platform/deploy-multi-tenant.sh --base-domain …` stands up the full self-service
  fleet. Both install the cluster prerequisites for you — in-cluster PostgreSQL, an ingress controller,
  Cognee, and (in acme mode) cert-manager and external-dns — each as a cluster singleton that auto-skips
  when you already run your own (`--no-ingress-nginx` / `--no-external-dns` to bring your own).
- **Per-org DNS records are now created automatically at runtime.** Instead of writing per-org records in
  Terraform, the install bundles the **external-dns** controller (`acme`/`clouddns` mode); the operator
  declares each org's records and external-dns reconciles them into your Cloud DNS zone — and reaps them
  when the org is removed. Terraform provisions only the zone, the install-time platform records, the
  reserved ingress IP, and a **single** `roles/dns.admin` Workload-Identity binding that external-dns and
  cert-manager DNS-01 **share** (no duplicate credential to manage).
- **Choose your TLS posture explicitly at install.** cert-manager runs in one of three modes: **off**
  (TLS terminated elsewhere), **selfSigned** (instant, dev/k3d/bare-IP, not browser-trusted), or **acme**
  (browser-trusted wildcard via Let's Encrypt DNS-01, which now also bundles external-dns and runs a DNS-01
  preflight that fails fast with exact remediation).
- **Catch a broken cluster before you install it.** `./platform/k8s-deploy.sh --preflight` runs a read-only
  check — default StorageClass present, a NetworkPolicy-enforcing CNI, first-party images pullable, your
  base domain's registrar NS-delegation resolves, and the DNS-write capability shared by external-dns +
  cert-manager is in place — and exits before changing anything, so you fix the environment once instead of
  debugging a half-installed, crash-looping cluster.
- **OIDC login works on a fresh install without a hand-created Secret.** When you pass OIDC settings, the
  installer creates the Kubernetes Secret holding the client secret and an auto-generated session secret and
  wires the chart at it — previously the Secret was assumed to already exist, so a fresh OIDC install
  crash-looped. Supply the client secret via `--oidc-client-secret` (or `OPENCRANE_OIDC_CLIENT_SECRET`).

### Changed

- **Deleting an organisation now tears down its per-org domain.** When a ClusterTenant is deleted
  the operator deprovisions the org's wildcard TLS `Certificate` and external-dns `DNSEndpoint`, so
  external-dns reaps the org's DNS records instead of leaving them dangling on namespace
  garbage-collection ordering. Idempotent and fail-soft — a teardown error is logged, never wedges
  the operator, with namespace GC as the backstop.

- **Cluster-tenant provisioner registry slimmed to a pure tier-availability gate.** Now the operator
  owns all org provisioning, the control plane's dead provisioner lifecycle code (the
  `provision`/`getStatus`/`deprovision` paths of the shared and external-webhook provisioners) was
  removed. The management API still gates which isolation tiers it accepts — `dedicatedCluster`
  remains unavailable unless an external webhook backend is configured over HTTPS — with no change to
  externally observable behaviour.

- **A ClusterTenant's `baseDomain` is replaced by `vanityDomain`.** Under the fixed-wildcard topology an
  org no longer brings its own base domain (its serving domain is derived as `<org>.<base>`); the field is
  repurposed as an OPTIONAL customer-vanity domain CNAMEd onto that apex. The API, `oc cluster-tenant`
  CLI (`--vanity-domain`), and the ClusterTenant CRD use the new name; existing values are carried over by
  the migration as vanity overlays.
- **Tenant gateways now refuse to trust an unconfigured proxy instead of trusting everything.** The
  trusted-proxy allowlist that decides which source the OpenClaw gateway will believe the
  `X-Forwarded-User` identity header from is now fail-closed: an operator with no
  `tenant.gateway.trustedProxies` configured renders a **trust-nothing** gateway — no connection
  authenticates — rather than an ambiguous empty list a runtime might read as trust-all. A typo'd
  CIDR/IP now crashes the operator at startup with the offending entry named, so a misconfiguration
  can never silently widen or narrow the trust boundary. The allowlist is Helm-values-driven
  (`tenant.gateway.trustedProxies`); the dev GKE overlay ships the cluster's ingress-nginx pod source
  range as its default so trusted-proxy auth works out of the box there.
- **Each tenant gateway is pinned to its owner (cross-tenant guard).** trusted-proxy auth trusts whatever
  identity the proxy injects, so the operator now renders `gateway.auth.trustedProxy.allowUsers` with the
  tenant owner's verified email — the gateway rejects any other `X-Forwarded-User`, so reaching another
  tenant's pod no longer grants access to its mounted secrets / MCP connections / model keys.

- **The control-plane Helm chart now wires human-login OIDC end to end.** A new
  `controlPlane.oidc.*` values block (issuer/client/redirect, client+session secret via an
  existing Kubernetes Secret or a dev inline fallback, group/role claim names, operator and
  org-admin groups, and the operator seed) is rendered into the control-plane container env.
  Previously the deployment injected no OIDC env, so OIDC and the operator/org-admin
  derivation were unreachable in-cluster. OIDC stays off (no env emitted) unless an issuer
  URL is set, and the operator seed is emitted only when non-empty — so a default install is
  unchanged and fail-closed.
- **Zitadel is documented as OpenCrane's single trusted OIDC issuer (Mode-2 broker), with no
  Microsoft Entra dependency.** `website/security/identity.md` now states this plainly and
  documents the expected `groups`/`roles` claim names (`OIDC_GROUPS_CLAIM`/`OIDC_ROLES_CLAIM`)
  and how the operator-group and seed-email parameters are configured at install.

> The 0.4.0 entries below record release-time capabilities. The Langfuse integration and metrics
> endpoint described there were removed in Unreleased.

## [0.4.0] — 2026-06-19

### Added

- **Register any AI model from any provider and make it routable across the platform.** Operators
  register models (`oc model add|list|update|remove`) and bind provider credentials that store only
  a Kubernetes Secret reference — a raw API key is never written to the database or transmitted over
  the wire. Both models and credentials are scoped Global or per-ClusterTenant; the backing
  LiteLLM instance is updated automatically (`/api/v1/models`, `/api/v1/providers/credentials`).
- **Pin a model to a skill, or let the platform choose automatically.** Each skill can declare a
  pinned model or opt into `auto` mode (`oc skill-posture`). Scope-level defaults (global or
  per-ClusterTenant) are set with `oc model-default`. At runtime the control plane resolves a single
  effective model per skill following the precedence: explicit request override → skill-pinned →
  skill-`auto` → ClusterTenant default → Global default — and writes it into the tenant's
  effective-contract without a pod restart.
- **Confine each tenant to only the models they are allowed to call.** The LiteLLM virtual key's
  `models[]` allowlist is now populated from the registry at key-mint time and kept in sync by the
  operator's reconcile loop (`oc routing …`). A tenant cannot call a model that is not in their
  allowlist, closing the previous gap where any tenant could call any registered model.
- **Measure what smarter routing would save before committing to any change.** Operators record
  golden eval cases (`oc routing eval-case`) and trigger a shadow-mode measurement run
  (`oc routing measurement run`) that replays each case against a candidate model, scores it with a
  vendor-neutral judge, and computes bootstrap 95% confidence intervals. A `RoutingProposal` is
  emitted only when the CI excludes zero savings. The measurement runner and judge are live seams
  (requiring a deployed LiteLLM + provider keys + `ROUTING_JUDGE_MODEL`; ops recipe in
  `docs/operators/routing-measurement.md`) — the first live savings number is an operator step on
  a real cluster, not a synthetic estimate.
- **Approve or reject routing proposals with a full audit trail; nothing is ever auto-applied.**
  Each `RoutingProposal` surfaces via `oc routing proposal list|approve|reject`. Approving pins the
  skill to the proposed model (via the AIR.3 write path) and records the decision; rejecting leaves
  routing exactly as-is. A RouteLLM/bandit policy learner and staged canary traffic rollout are
  future additions — the proposal lifecycle is the gate, and that gate is human-only today.
- **Read AI cost and quality metrics from the console without the browser holding Langfuse
  credentials.** `GET /api/v1/model-routing/metrics` (`oc routing metrics`) proxies Langfuse's
  public metrics API with server-side authentication; non-operators receive an automatic
  tenant-dimension filter; the endpoint returns 503 when Langfuse is not configured and fails
  closed with 403 when a caller's ClusterTenant cannot be resolved.
- **Surface a ranked "save up to N%" feed that drives one-click human-gated improvement.**
  `GET /api/v1/model-routing/recommendations` (`oc routing recommendation list`) joins each
  skill's latest measurement with any open proposal, sorts by projected savings descending, and
  scopes results by ClusterTenant — operators see the full fleet; non-operators see only their own.
  This is the feed behind the console's savings-recommendation tile.

- **Model each customer as a first-class, API-managed isolation unit.** Operators create
  and manage customers with `oc cluster-tenant create|list|show|update|delete` (or
  `/api/v1/cluster-tenants`), choosing an `isolationTier` — `shared`, `dedicatedNodes`, or
  `dedicatedCluster` — per customer. The resource is cluster-scoped, carries its own status
  lifecycle (`pending → provisioning → ready`), and enforces a hard invariant: one customer
  = one `ClusterTenant` = one instance. Openclaws attach to a customer by setting
  `spec.clusterTenantRef`; single-install stays the zero-config default and is
  byte-for-byte unchanged — multi-tenancy is strictly opt-in.
- **Gate and dedicate compute per customer natively, without an admission webhook.** When a
  customer is opted in, the operator provisions a per-`ClusterTenant` namespace labelled
  with PSA `restricted`, derives a `ResourceQuota` and `LimitRange` from the customer's
  declared quota (`cpu`/`memory`/`pods`/`storage`/`gpu`), and stamps `nodeSelector` +
  `tolerations` from `spec.compute` onto each openclaw pod spec. The operator is the sole
  pod-creator so the enforcement is structural — one customer cannot starve or interfere
  with another's resources, and `dedicatedNodes` pins the customer to its own node pool
  without any additional admission machinery.
- **Plug in a `dedicatedCluster` backend without forking or touching the AGPL tree.** The
  control plane delegates to an out-of-process provisioner over an HTTPS webhook, posting a
  vendor-neutral `ClusterTenantProvisionRequest` (published in the MIT `libs/contracts`)
  and reading back a status plus a kubeconfig Secret reference — credential material never
  crosses the wire inline. A private vendor implements the contract in their own service;
  nothing vendor-specific lives in the AGPL core. Configure via Helm
  (`clusterTenant.provisionerWebhook.url`); `dedicatedCluster` is rejected `422
  TIER_UNAVAILABLE` until a backend advertises it (fail-closed).

- **Every service now emits structured, trace-correlated logs — and a single Helm toggle
  wires the whole fleet to GCP Cloud Logging + Cloud Trace (or any OTLP backend).** All
  OpenCrane services share a single `@opencrane/observability` library that writes
  synchronous pino JSON directly to stdout on every deployment, with no configuration
  required: each log record carries a `requestId` (propagated through the full async
  call-tree via `AsyncLocalStorage` without threading it by hand), and known secret fields
  (`authorization`, `token`, `apiKey`, `masterKey`, `client_secret`, `DATABASE_URL`, and
  their nested equivalents) are redacted before the record is serialised. Any stray
  `console.*` calls — from first-party code or noisy third-party libraries — are
  transparently routed into the same structured pipeline. The CLI writes to stderr so
  stdout stays reserved for `--output json`. Distributed tracing is opt-in: set
  `observability.otel.enabled: true` in Helm and the chart deploys an in-cluster
  OpenTelemetry Collector (DaemonSet by default, single Deployment for GKE Autopilot) that
  receives OTLP traces from all services, scrapes pod stdout via the filelog receiver,
  promotes pino's `trace_id`/`span_id` fields to first-class log attributes so logs and
  traces correlate in Cloud Trace, and exports both to GCP Cloud Logging + Cloud Trace
  (`exporter.backend: googlecloud`) or to any downstream OTLP endpoint
  (`exporter.backend: otlp`). Tracing is a no-op on a laptop or in CI when no collector
  endpoint is configured — nothing times out or errors.

### Changed

- **GKE secret encryption is on by default for all new cluster deployments.** The Terraform GKE
  module now provisions a dedicated KMS keyring and crypto key (90-day auto-rotation,
  `prevent_destroy`) and enables GKE application-layer `database_encryption` pointing at that key.
  Existing clusters are unaffected; enable via `enable_secrets_encryption=true` in Terraform.
- **LiteLLM is pinned to a stable image tag.** The Helm deployment now references
  `main-v1.81.0-stable` instead of `:main-latest`, so cluster upgrades are deliberate and
  reproducible.

- **Expose the control plane ingress at the root domain instead of the `admin` subdomain.** The control plane ingress host maps directly to the base `ingress.domain` configured in Helm (e.g. `opencrane.local`), rather than prepending `admin.`.

### Security

- **Credential and model mutation routes fail closed outside dev mode.** The
  `cluster-tenant-scope` middleware guards every POST/PUT/DELETE on model, credential, and
  skill-posture routes: platform operators may act at any scope; non-operators are restricted to
  their own ClusterTenant; Global mutations are operator-only; denials return `403
  FORBIDDEN_SCOPE`. Critically, when no session is present the guard now **fails closed** unless
  `_IsDevAuthMode()` is true — a sessionless request to a mutation route is denied on any real
  deployment. The open dev backend remains permissive; production is enforced.
- **Provider credentials never store a raw key.** The `/api/v1/providers/credentials` endpoint
  rejects any payload containing a raw key material field with a `400`; only a `secretRef` (a
  Kubernetes Secret name) is accepted and stored. This applies at both Global and
  per-ClusterTenant scope.

- **The provisioner webhook refuses a non-`https://` URL at startup**, so the bearer token
  used to authenticate to a vendor's dedicated-cluster backend is never sent in plaintext
  under any configuration.

## [0.3.0] — 2026-06-15

Multi-customer isolation, fleet-wide organizational awareness, and hardened connection security.

### Added
- **Run many isolated customers on one cluster.** Operators can stand up N fully-isolated
  OpenCrane instances in a single Kubernetes cluster (opt-in; single-install stays the
  default). Each customer gets its own namespace, scoped RBAC, cert issuer/secret store, and
  a cross-instance default-deny network boundary — one customer cannot see, reach, or
  reconcile another's resources, and tearing one down leaves the others untouched. CRDs are
  installed once cluster-wide so instances upgrade independently against a published
  version-compatibility matrix.
- **Every agent answers from one governed org-knowledge contract.** Tenants' OpenClaw agents
  retrieve org context directly from their Cognee with **mandatory citations** (uncitable
  results are dropped, never shown unattributed). Access-policy changes now propagate to
  retrieval grants automatically.
- **Ship awareness changes safely across the fleet.** The awareness contract is versioned and
  rolls out **canary-style** (personal → project → department → org) with **one-step
  rollback** and optional shadow mode; a **golden-query suite gates rollouts** on zero policy
  violations. Operators monitor fleet awareness SLOs (dashboards + alerts) and per-tenant
  participation, all drivable from `oc awareness …`.
- **Personalize agents per company without losing platform control.** Companies publish their
  own **immutable, versioned** voice/policy docs that reconcile into each tenant's agent via
  an **approve-before-apply 3-way merge**, applied **live without a pod restart**. Platform-
  owned behaviour is re-stamped every boot and can never be overridden by a tenant or company doc.
- **Distribute skills as signed OCI artifacts.** Skills are stored and delivered as OCI/Zot
  blobs (digest-pinned) instead of database rows, with an `oc` backfill path. The skill
  registry serves get-by-digest only, enforces per-read entitlement, and hides the existence
  of skills a tenant isn't entitled to.

### Security
- **No long-lived agent credential in the browser.** Operator→pod connections are brokered
  through the control plane with short-lived, re-brokered credentials, enforced `wss://`,
  HSTS, and production-forced `Secure` cookies — plus a **per-user kill-switch** that severs
  live sessions and blocks re-auth.
- **Proprietary frontends can integrate cleanly.** The contracts SDK is MIT-licensed (the core
  stays AGPL), so external/closed clients can consume the API at arm's length; `openapi.json`
  is published as a release asset.

## [0.2.0] — 2026-06-11

First tagged release — a working multi-tenant OpenClaw platform you can deploy and operate end-to-end.

### Added
- **Stand up a multi-tenant OpenClaw platform.** Deploy operator + control-plane + per-tenant
  OpenClaw pods via Helm, with end-to-end tenant reconciliation (validated on k3d and GCP) and
  OIDC login for human operators.
- **Control AI spend per tenant.** LiteLLM-based cost routing with per-tenant AI budget, spend,
  and key management under a single API, plus production guards against placeholder secrets.
- **Give agents org-aware retrieval.** Cognee-backed retrieval with enforced per-tenant
  datasets and an organization index schema carrying lineage, freshness, confidentiality, and
  jurisdiction metadata.
- **Govern identity, MCP servers, and skills.** Groups/grants with a 5-level scope compiler;
  MCP server and skill-catalog management; projected-token tenant identity; a security ingest
  scanning gate; and operator drift-repair of runtime-plane config.
- **Operate headlessly, API-first.** Everything runs through a versioned `/api/v1` with coded
  error envelopes + OpenAPI and the `oc` CLI — no UI dependency. Cloud-agnostic hosting via the
  GoF adapter (GCP + on-prem), replacing Crossplane.

## [0.1.0] — 2026-03-15 _(untagged)_

- Initial scaffold of the multi-tenant OpenClaw platform (operator, control-plane, Angular app,
  launch script). Folded into the 0.2.0 tag.

[Unreleased]: https://github.com/elewa-git/opencrane/compare/0.9.0...HEAD
[0.9.0]: https://github.com/elewa-git/opencrane/compare/0.8.1...0.9.0
[0.6.1]: https://github.com/elewa-git/opencrane/compare/0.6.0...0.6.1
[0.6.0]: https://github.com/elewa-git/opencrane/compare/0.5.3...0.6.0
[0.5.3]: https://github.com/elewa-git/opencrane/compare/0.5.2...0.5.3
[0.5.2]: https://github.com/elewa-git/opencrane/compare/0.5.1...0.5.2
[0.5.1]: https://github.com/elewa-git/opencrane/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/elewa-git/opencrane/compare/0.4.0...0.5.0
[0.4.0]: https://github.com/elewa-git/opencrane/releases/tag/0.4.0
[0.3.0]: https://github.com/elewa-git/opencrane/releases/tag/0.3.0
[0.2.0]: https://github.com/elewa-git/opencrane/releases/tag/0.2.0
