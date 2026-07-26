# @opencrane/backend/agents/execution/inputs — run input snapshot assembly

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › inputs

## What it owns

This package is part of the **shared execution flow** used by both personal and managed agents.
Before an agent runtime executes a run, the platform freezes *everything* that run is allowed to see
and use into one immutable record — the
**`RunInputSnapshot`**: which messages, which persona, which memory facts, which tools and budgets,
and which verified identity. This package owns the **assembly** of that snapshot: it gathers each
input from an injected authority, validates the combination, and hands the finished snapshot to the
run-admission transaction that persists it. After that instant nothing about the run's input can
change — a retry, an audit, or a replay all see the exact same record, identified by its digest
(a SHA-256 fingerprint of the canonical content).

```
 run request  (runId · silo · service · thread? · subject · idempotency key)
          │  __AssembleRunInputSnapshot
          ▼
 ┌─────────────────────────────────────────┐
 │   execution/inputs  ◄── HERE              │  load run/persona/thread/preferences/
 │   · orchestrates 9 authority loads        │  memory/tools/skill eligibility/budget/identity,
 │   · compiles + digests the one snapshot   │  the runs package's admission transaction
 │   · compiles deterministic runtime input  │
 └─────────────────────────────────────────┘
          │  ready (authority + snapshot) / denied (one precise reason)
          ▼
 runs · RunAdmissionRepository  ── persists run + snapshot + outbox events in one commit
```

**In this flow:** [execution/runs](../../runs/main/README.md) *(owns the admission transaction, the digest
function, and the durable rows)* · [membership](../../../../server/iam/membership/main/README.md)
*(supplies the signed fleet-membership evidence behind the identity envelope)*

Every input is loaded through a port (`RunAuthoritySource`, `ApprovedPersonaSource`, …) inside the
**same database transaction** that admits the run, so a permission revoked or a membership expired a
millisecond before commit can never leak into the frozen record. In particular, the required
`SkillRevisionEligibilitySource` locks every skill assignment and verifies that each skill returned
after effective-grant intersection is an assigned, same-silo, still-published, non-revoked revision. One refusal anywhere denies the
whole assembly with a single precise reason; a duplicate request (same idempotency key) returns the
previously admitted snapshot without recompiling anything.

Third-party tools enter the snapshot as revision-selected integration assignments, each containing
only an integration identifier and its allowed tool names. The assembler never receives a custody
credential or an old MCP grant: the later action boundary resolves the live custody reference and
checks the same revision assignment again.

Invariant: a run either commits with its one complete, digest-sealed input snapshot, or it does not
exist — there is no partially assembled state, and no snapshot field originates from unverified
caller input.

## Public surface

- `__AssembleRunInputSnapshot(command, authorities)` — the end-to-end assembly: validate → load all
  sources inside the admission transaction → compile, digest, and persist.
- `FleetMembershipIdentityEnvelopeSource` — the identity port implementation: accepts only a
  cryptographically verified fleet-membership assertion (never caller-supplied claims) and a
  same-transaction capability-set digest.
- `PersonalMemoryScopeSource` — selects a personal memory dataset from that verified identity's
  silo, organization, and subject. It cannot receive a dataset identifier from the runtime caller.
- `ManagedExecutionIdentityEnvelopeSource` — adapts the agent-service authority's current signed
  fleet-membership and effective non-personal scope evidence into a tagged `service` identity. Its
  canonical `agent-service:<id>` principal must match the admitted service; a requester never
  becomes that service's execution identity.
- `ManagedNoPersonalMemoryScopeSource` — seals managed work with `{ scope: "none" }` and no fact
  references. It is an explicit boundary, not a fallback to user, organization, or workspace
  memory; future managed knowledge recall needs a separately authorized source.
- `PrismaRunAuthoritySource`, `PrismaApprovedPersonaSource`, `PrismaThreadContextSource`,
  `PrismaPreferenceFactSource`, `PrismaRevisionToolPolicySource`, and
  `PrismaRevisionBudgetPolicySource` — production transaction readers for the live service,
  persona, transcript, organization-bound consented preferences, tools, and resource ceilings.
  `__CreatePrismaManagedSessionAssemblyAuthorities` composes them with caller-owned identity and
  final skill-eligibility authorities.
- `PrismaSkillRevisionEligibilitySource` — locks the AgentRevision's skill assignments
  at admission and refuses an invented, foreign, revoked, or unpublished revision with
  `skill_unavailable`.
- `SessionAssemblyAuthorities` / `SessionAssemblyCommand` — the port bundle and the immutable run
  coordinates a caller supplies.
- `RunAuthoritySource`, `ApprovedPersonaSource`, `ThreadContextSource`, `PreferenceFactSource`,
  `MemoryScopeSource`, `ToolPolicySource`, `SkillRevisionEligibilitySource`, `BudgetPolicySource`, `IdentityEnvelopeSource`,
  `CapabilitySetDigestSource` — the per-input ports the OpenCrane app implements with real adapters.
- `AssembleRunInputSnapshotResult` / `SessionAssemblyRefusalReason` — the all-or-nothing outcome and
  its refusal vocabulary.
- `__CompileRunInput` / `__AppendCompiledTool` — deterministic expansion of a sealed snapshot into
  runtime-owned prompt input, with a version stamp that makes a compiler change visible in evidence.
- `PromptCompilerRepositories` — injected read ports used only to dereference snapshot-authorized
  content while compiling.

## Boundary

Consumed by the run-admission path in the OpenCrane app, which composes the ports with real
authority adapters. It does not select a runtime driver, approve a persona, issue capabilities, or
read mutable workspace files — and it never touches storage directly: every read goes through a
port, and the only write goes through the [runs](../../runs/main/README.md) package's
`RunAdmissionRepository`. The deterministic compiler reads only content already named by the sealed
snapshot; it cannot add a new tool, memory record, or policy. Fail-closed throughout: malformed coordinates, a stale membership, a
non-canonical digest, or any single source refusal denies the run.

## Dependency direction

Tagged `scope:execution-inputs`: it may depend only on `scope:agents`, `scope:agent-services`,
`scope:artifacts`, `scope:membership`, `scope:personal-memory`, `scope:execution-runs`,
`scope:execution-inputs`, and `scope:shared` — never on apps or unrelated domains. The
agent-services dependency is one-way: this package consumes managed-service evidence but never
decides service publication, membership, or scope attachment policy.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [runs](../../runs/main/README.md) · [conversations](../../../personal/conversations/main/README.md) ·
  [memory](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
