# @opencrane/backend/agents/execution/inputs — run input snapshot assembly

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › inputs

## What it owns

This package is part of the **shared execution flow** used by both personal and managed agents.
Before a conversation computer executes a run, the platform freezes *everything* that run is allowed to see
and use into one immutable record — the
**`RunInputSnapshot`**: which messages, which persona, which memory query coordinates, which tools and budgets,
and which evidence-bound execution subject. This package owns the **assembly** of that snapshot: it gathers each
input from an injected authority, validates the combination, and hands the finished snapshot to the
run-admission transaction that persists it. After that instant nothing about the run's input can
change — a retry, an audit, or a replay all see the exact same record, identified by its digest
(a SHA-256 fingerprint of the canonical content).

The compiled budget retains the frozen model-turn limit. A conversation computer consumes exactly
one admitted turn and refuses the model request when that limit is absent or below one.

```
 run request  (runId · silo · service · conversation? · subject · idempotency key)
          │  __AssembleRunInputSnapshot
          ▼
 ┌─────────────────────────────────────────┐
 │   execution/inputs  ◄── HERE              │  load run/persona/conversation/preferences/
 │   · orchestrates 9 authority loads        │  memory/tools/skill eligibility/budget/identity,
 │   · compiles + digests the one snapshot   │  the runs package's admission transaction
 │   · compiles deterministic runtime input  │
 └─────────────────────────────────────────┘
          │  ready (authority + snapshot) / denied (one precise reason)
          ▼
 runs · RunAdmissionRepository  ── persists run + snapshot in one commit
```

**In this flow:** [execution/runs](../../runs/main/README.md) *(owns the admission transaction, the digest
function, and the durable rows)* · [membership](../../../../server/iam/membership/main/README.md)
*(supplies signed fleet-membership evidence consumed by the execution-subject authority)*

Every input is loaded through a port (`RunAuthoritySource`, `ApprovedPersonaSource`, and the other
named sources) inside the
**same database transaction** that admits the run, so a permission revoked or a membership expired a
millisecond before commit can never leak into the frozen record. In particular, the required
`SkillRevisionEligibilitySource` locks every skill assignment and verifies that each skill returned
after effective-grant intersection is an assigned, same-silo, still-published, non-revoked revision. One refusal anywhere denies the
whole assembly with a single precise reason; a duplicate request (same idempotency key) returns the
previously admitted snapshot without recompiling anything.

Conversational admission records an exact `Conversation / Use` decision for the requester inside
that final transaction, using the same membership revision, run-arguments digest, and admission
instant. The earlier participant check remains defense-in-depth; it cannot replace this final fence
because membership or grants may change before persistence.

Resource-use decisions record the execution Principal: `user` for a personal agent acting through
its human owner, or `agent-service` for a company agent acting through its own Principal. The
requester's Conversation Use remains a separate human decision. These server-side admissions do
not claim a runtime Pod identity; workload decisions still require verified Kubernetes coordinates.

MCP tools enter the snapshot as revision-selected immutable tool revisions. Each entry contains the
saved tool identifier, name, description, input schema, and schema digest. Missing, malformed, or
digest-mismatched schemas fail admission. The assembler never receives registry or provider
credentials; execution consumes only the admitted OCI-backed MCP revision.

Invariant: a run either commits with its one complete, digest-sealed input snapshot, or it does not
exist — there is no partially assembled state, and no snapshot field originates from unverified
caller input.

## Public surface

`PrismaConversationExecutionSubjectAuthority` selects personal or managed admission from the
current active service and published revision inside the admission transaction. It invokes exactly
one handler; a refused personal identity is never retried as managed.

`ManagedConversationExecutionSubjectAuthority` binds the company's own stable Principal and checked
identity to the active computer lease. The human requester retains separate signed membership and
current Invoke permission. The company Principal needs current Use on its model; the human needs
current Use on the conversation. No personal persona, memory or tool assignment enters the initial
company revision. An explicit no-personal-memory policy returns an empty preference list without
opening the personal-memory repository.

The production conversation computer repeats this authority check during bootstrap and before
output, including retries that return an existing run snapshot. Current service state, revision,
identity, signed human membership and required grants must still admit the operation. The frozen
snapshot supplies evidence and input limits; it cannot restore removed access.

`__RunInputAuthorityExpiresAt` bounds model credentials by the earliest original execution-evidence
expiry, requester-evidence expiry and absolute budget deadline. It verifies run/attempt binding and
the compiled deadline against the snapshot. Assembly returns the currently checked subject separately
from the unchanged snapshot. A retry intersects both subjects' trust deadlines: shorter current
evidence reduces credential validity, while refreshed evidence never extends the original ceiling.

- `__AssembleRunInputSnapshot(command, authorities)` — the end-to-end assembly: validate → load all
  sources inside the admission transaction → compile, digest, and persist.
- `ExecutionSubjectAuthority` — injects one current AgentIdentity, Principal, membership,
  capability, run, and ConversationComputer-lease proof. A requester remains provenance, never
  an execution identity.
- `PersonalConversationExecutionSubjectAuthority` — joins the checked current AgentIdentity head,
  transaction-bound personal service and authorization evidence, and the current active
  ConversationComputer lease. It rechecks every request, service, revision, profile, computer,
  lease, generation, and SandboxClaim coordinate before issuing an attempt-one subject. Its
  evidence-authority factory receives the admission transaction so Prisma evidence cannot escape
  onto a root client.
- `__CreatePrismaSessionAssemblyAuthorities` — composes the production readers around that subject
  authority, an exact durable-history reader, and an explicit run policy. It freezes only the verified principal's active Cognee
  dataset coordinates when that policy allows personal memory.
  Admission never stores the recall query, reads fact content, or calls Cognee. The model chooses a
  query only through the approval-required `memory_recall` tool; safe content delivery is deferred to #601.
- `PrismaSkillRevisionEligibilitySource` — locks the AgentRevision's skill assignments
  at admission and refuses an invented, foreign, revoked, or unpublished revision with
  `skill_unavailable`.
- `AssembleRunInputSnapshotResult` / `SessionAssemblyRefusalReason` — the all-or-nothing outcome and
  its refusal vocabulary.
- `__CompileRunInput` / `__AppendCompiledTool` — deterministic expansion of a sealed snapshot and
  authoritative live attempt into runtime-owned prompt input, with both coordinates digest-sealed
  and a version stamp that makes a compiler change visible in evidence.
- `PromptCompilerRepositories` — injected read ports used only to dereference snapshot-authorized
  content while compiling.
- `ConversationHistoryAdmissionReader` re-reads the exact Kurrent revision, ordered identifiers,
  final triggering message, and immutable human author before those identifiers enter a snapshot.
- `VerifiedConversationPromptMessageRepository` accepts decrypted messages only when the
  conversation-owned source returns the complete snapshot set exactly once and in order.

All other source adapters and assembly ports are package-private implementation details. Same-package
tests import their owning modules directly; adding a test does not widen this barrel.

`PrismaPromptCompilerRepository` is the transaction-bound dereference boundary for admitted
persona instructions, MCP tool revisions, artifact revisions, skill revisions, and model routes.
It receives canonical conversation messages through `VerifiedConversationPromptMessageRepository`,
so it has no relational transcript path. Missing rows, changed schemas, foreign model coordinates,
inactive parents, and unsupported generated-output capabilities fail compilation closed.

## Boundary

Consumed by the run-admission path in the OpenCrane app, which composes the ports with real
authority adapters. It does not select a runtime driver, approve a persona, issue capabilities, or
read mutable workspace files — and it never touches storage directly: every read goes through a
port, and the only write goes through the [runs](../../runs/main/README.md) package's
`RunAdmissionRepository`. The deterministic compiler reads only non-memory content already named by
the sealed snapshot; memory dataset coordinates never enter compiled input. It
cannot add a new tool, memory record, or policy. Fail-closed throughout: malformed coordinates, a stale membership, a
non-canonical digest, or any single source refusal denies the run.

The OpenCrane app composes one admission variant. The participant-owned conversation route derives
requester provenance from the authenticated session and host; the injected subject authority then
resolves the exact AgentIdentity, Principal, membership, capability, run, and computer lease inside
the admission fence. Conversation history already contains the encrypted human entry before run
admission. The injected history adapter re-reads that exact Kurrent revision and decrypts referenced
private payloads for prompt compilation; this package never inserts a relational copy. The
conversation ID comes from verified computer state, and identity, principal, silo, service, dataset,
and membership coordinates never come from the browser.

There is no public run-start endpoint. Direct and group messages never enter this package; only an
agent-session message or an internal managed trigger can request snapshot assembly.

## Dependency direction

Tagged `scope:execution-inputs`: it may depend only on `scope:agents`, `scope:artifacts`,
`scope:authorization`, `scope:membership`, `scope:personal-memory`, `scope:execution-runs`,
`scope:execution-inputs`, and `scope:shared` — never on apps or unrelated domains. It receives its
execution subject through a narrow port and never decides identity, membership, grant, capability,
or ConversationComputer-lease policy.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [runs](../../runs/main/README.md) ·
  [personal-memory selection](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
