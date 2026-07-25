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
 │   · orchestrates 8 authority loads        │  memory/tools/budget/identity, all inside
 │   · compiles + digests the one snapshot   │  the runs package's admission transaction
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
millisecond before commit can never leak into the frozen record. One refusal anywhere denies the
whole assembly with a single precise reason; a duplicate request (same idempotency key) returns the
previously admitted snapshot without recompiling anything.

Invariant: a run either commits with its one complete, digest-sealed input snapshot, or it does not
exist — there is no partially assembled state, and no snapshot field originates from unverified
caller input.

## Public surface

- `__AssembleRunInputSnapshot(command, authorities)` — the end-to-end assembly: validate → load all
  sources inside the admission transaction → compile, digest, and persist.
- `FleetMembershipIdentityEnvelopeSource` — the identity port implementation: accepts only a
  cryptographically verified fleet-membership assertion (never caller-supplied claims) and a
  same-transaction capability-set digest.
- `PrismaRunAuthoritySource` — the first concrete admission source: after the run repository locks
  the service, it accepts only an active service whose exact active pointer still names a published
  revision in the same silo. It derives the revision digest and prompt-compiler version from that
  immutable revision; it never trusts a revision identifier from the request.
- `PrismaRevisionToolPolicySource` / `PrismaRevisionBudgetPolicySource` — concrete revision-input
  sources. They accept only a current published revision with a silo-available model, live
  integration custody, published active skills, and published artifact revisions; the budget source
  turns the revision's positive turn/token/duration ceilings into the frozen compiler policy. The
  model route carries its exact definition ID beside its public alias, preventing a same-named global
  or tenant model from being selected later.
- `PrismaApprovedPersonaSource` — resolves a personal run only through the delegated user's profile
  in the same silo and accepts its current revision only while it remains approved. Managed runs carry
  no persona, and neither a service nor a caller can select another person's persona revision.
- `PrismaPreferenceFactSource` — admits optional personalisation only from the user's active
  `Personal` memory dataset. A fact also needs active state, explicit or confirmed consent, and
  provenance naming that exact user; shared-scope, inferred, retired, and unproven facts never enter
  a run snapshot.
- `PrismaThreadContextSource` — accepts a conversation only when its active thread is bound to the
  exact service, silo, and authenticated participant. It freezes ordered IDs of completed messages
  only; pending and streaming content cannot race into an immutable run input.
- `PrismaMemoryScopeSource` — limits personal memory to the delegated user's active `Personal`
  dataset, active explicit/confirmed facts, and complete provenance-backed content digests. It bounds
  the frozen set to 100 facts and returns an explicit no-memory policy for managed or unprovisioned
  users.
- `SessionAssemblyAuthorities` / `SessionAssemblyCommand` — the port bundle and the immutable run
  coordinates a caller supplies.
- `RunAuthoritySource`, `ApprovedPersonaSource`, `ThreadContextSource`, `PreferenceFactSource`,
  `MemoryScopeSource`, `ToolPolicySource`, `BudgetPolicySource`, `IdentityEnvelopeSource`,
  `CapabilitySetDigestSource` — the per-input ports the OpenCrane app implements with real adapters.
- `AssembleRunInputSnapshotResult` / `SessionAssemblyRefusalReason` — the all-or-nothing outcome and
  its refusal vocabulary.

## Boundary

Consumed by the run-admission path in the OpenCrane app, which composes the ports with real
authority adapters. It does not select a runtime driver, approve a persona, issue capabilities, or
read mutable workspace files — and it never touches storage directly: every read goes through a
port, and the only write goes through the [runs](../../runs/main/README.md) package's
`RunAdmissionRepository`. Fail-closed throughout: malformed coordinates, a stale membership, a
non-canonical digest, or any single source refusal denies the run.

## Dependency direction

Tagged `scope:execution-inputs`: it may depend only on `scope:agents`, `scope:artifacts`,
`scope:membership`, `scope:execution-runs`, `scope:execution-inputs`, and `scope:shared` — never on
apps or unrelated domains.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [runs](../../runs/main/README.md) · [conversations](../../../personal/conversations/main/README.md) ·
  [memory](../../../personal/memory/main/README.md) · [personas](../../../personal/personas/main/README.md)
