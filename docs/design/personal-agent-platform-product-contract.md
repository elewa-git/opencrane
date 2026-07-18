# Personal-agent platform product contract

Status: **accepted product direction; implementation in progress**

OpenCrane is a new product under active development. Existing OpenCrane installations are not a
production estate to preserve or transition. They may be destroyed at any time and are not an input
to the target architecture.

## Product capabilities

| Capability | Target contract |
|------------|-----------------|
| Organization identity and membership | Use OIDC and fleet lifecycle/membership as live external authorities. A cached membership revision is trusted only when its issuer signature verifies, its revision is the newest observed for that silo, and its bounded freshness has not expired. Fail closed after expiry. |
| Personal agent conversation | Provide streaming messages, ordered history, tool events, abort, retry/recovery, and stable thread ownership through the Thread, Run, and RunEvent contracts. A user message sent while a run is active is durably queued and considered before the agent's next action; if the run reaches its final response first, the message starts the next run. The user is always shown which of the two happened, and queued input survives reconnect, Pod replacement, and recovery. |
| Persona and preferences | Require an onboarding interview before the first personal-agent session. Key answers select a versioned `SOUL.md` template and infuse a small set of explicit interview insights into a reviewable first PersonaRevision. The user approves, edits, or retakes it and may replace it later. |
| Personal and agent memory | Store durable organization memory in Cognee with explicit dataset identity, scope, and provenance. |
| Company, document, and artifact knowledge | Keep canonical bytes and versions in ArtifactStore and index derived knowledge in Cognee. |
| Artifacts and documents | Provide uploads and generated outputs with ownership, hashes, MIME type, provenance, and conversation/run links. |
| Models, BYOK, and budgets | Govern provider choice, model catalogs, routing, budgets, and usage through the new LiteLLM-backed contracts. |
| MCP integrations | Provide a governed catalog, assignments, grants, scoped execution, and Obot-backed credential custody. |
| Skills | Provide immutable skill revisions, entitlements, review, and artifact bytes. |
| Schedules and managed runs | Provide schedules, pause/resume, approval, retry, and exactly-once intent through AgentRun, CronJob, and Job ownership. |
| Audit and operations | Provide immutable security/product audit evidence, structured observability, backup/restore, and operator controls. |
| Storage and retention | Retain target-product data indefinitely by default until an explicit user/administrator deletion. Put every durable state path on an explicitly mounted, expandable volume; never use an agent Pod filesystem as durable storage. |
| Future updates | Roll each supported application update to ready, traffic-serving target Pods in under five minutes per silo, without copying product data or keeping a parallel predecessor runtime. |

Awareness rollout/participation, pairing, BrokeredDevice, SessionScope, gateway-admin state,
Tenant and AccessPolicy CRDs as business authority, and OpenClaw protocols/workspaces/plugins/runtime
state are not target product capabilities.

## Authorization

OpenCrane defines authorization directly:

1. compile all applicable direct and group grants;
2. choose the highest priority;
3. at equal priority, Deny wins;
4. use timestamps only where a contract explicitly requires a deterministic tie-break;
5. keep `project` as a separate containment dimension whose membership may span departments;
6. treat dataset-membership rows as derived projections of grants, never as authority.

Department membership neither grants nor prevents project membership. Project grants are explicit
and combine with the other grants through the priority and Deny-at-equal-priority rules.

## Identity and membership failure behavior

- Fleet lifecycle and membership remain live external authorities.
- Signed authority responses may be cached for a bounded operational freshness window.
- A signed membership revision contains the silo/organization, monotonically increasing revision,
  issued-at/expiry times, membership assertions, issuer identity, and signature. “Last signed” means
  the highest revision the silo has verified from the fleet authority, not a locally editable copy.
- Unknown membership, a missing subject binding, or a stale response must not authorize login, a
  new run, grant expansion, administration, or capability renewal.
- An authority read failure must never turn an unknown member into an active member.
- The exact freshness SLO is an ordinary runtime reliability and security setting. It is not a
  prerequisite for refactoring the product.

## Clean-build implementation rule

Implement the target contracts directly. Do not add backwards compatibility, legacy schemas or
protocols, dual reads or writes, migration utilities, importers, exporters, old database or object
store readers, old keys or salts, static-token escapes, reverse bridges, deprecation shims, or
transitional runtime slots.

Existing development data, credentials, deployments, clusters, stores, and generated state may be
deleted. Development fixtures must be authored against the target contracts rather than copied,
translated, or inferred from obsolete behavior.

Continuing OIDC, fleet, Cognee, Obot, LiteLLM, and other target dependencies are integrated through
their current target contracts. Their use does not justify preserving an obsolete OpenCrane
adapter, identifier, projection, credential, or data shape.

## Persona onboarding

The first personal-agent session is blocked until the user completes or explicitly restarts the
onboarding interview. The versioned question set covers at least: relationship/role, tone and
language, answer structure, challenge-versus-support preference, initiative level, approval/risk
boundaries, working habits, and memory boundaries. Answers select one reviewed `SOUL.md` template;
three to five high-signal statements are rendered into explicit, provenance-linked fields. The
generated result is previewed as a PersonaRevision and requires user approval. Runtime Pods receive
only the compiled revision; they do not own or mutate a durable `SOUL.md` file.

## Storage, retention, and updates

- Postgres, ArtifactStore, Cognee, and every other durable store use explicitly mounted persistent
  volumes whose StorageClass supports online expansion. Capacity thresholds alert and expand before
  exhaustion; growth does not require copying user data into a new product path.
- Target transcripts, persona revisions, memories, artifacts, runs, and audit evidence have no
  automatic TTL or expiry. They remain until an explicit authorized deletion and its reference-safe
  purge completes.
- Agent-runtime workspaces are mounted scratch (`emptyDir` or lease-scoped ephemeral volumes), are
  never authoritative or backed up, and are cleared on Pod replacement, scale-to-zero, or lease
  expiry. Container root filesystems are non-authoritative and read-only where supported.
- A future application rollout drains or fences active work, starts the one supported target image,
  remounts its existing durable volumes, passes readiness, and resumes from canonical state in under
  five minutes per silo. No parallel product runtime or data transformation is part of that SLO.

## Implementation acceptance

Each implemented slice must demonstrate:

- tests authored against the target capability and authorization contracts;
- no runtime dependency on an obsolete schema, protocol, store, credential, identifier, or API;
- no compatibility, transfer, dual-write, static-token, or reverse-bridge path;
- fail-closed identity, authorization, and credential behavior;
- tenant isolation and scoped external-I/O authorization;
- structured logs and traces for external-I/O paths;
- backup/restore coverage for data created by the new product where that capability owns durable
  state; and
- independent review with no unresolved Critical or High security finding.

Performance, availability, and cost are measured against the new product's stated SLOs and workload
tests, not against an obsolete implementation.

> See also: [personal-agent platform architecture](personal-agent-platform-architecture.md) and
> [direct-refactor implementation plan](personal-agent-platform-direct-refactor-plan.md).
