# Agent loading / session-creation flow — design spec

- **Status:** Specified (decision D18, 2026-07-19) — design-first; implementation lands in the
  Phase E runtime lane ([#246](https://github.com/italanta/opencrane/issues/246))
- **Origin:** `PHASE-D-FEEDBACK-DECISIONS.md` D18; ADR 0008 (RunInputSnapshot, persona onboarding);
  [`openclaw-agent-loop-replacement-plan.md`](openclaw-agent-loop-replacement-plan.md) L2
- **Audience:** the implementing agent (Codex) and its reviewer. This spec is the contract; the
  implementation must not invent flow shape beyond it.

## Why this flow exists

Phase D left a hole a reader (and the runtime) trips over: there is an *approval* flow for
personas, but no cohesive **"load the agent / create the session"** flow. Concretely, at stack
HEAD:

- `RunInputSnapshot` exists as a contract type (`libs/contracts/src/run-input-snapshot.types.ts`)
  and as an immutable Prisma model (`apps/opencrane/prisma/schema/runs.prisma`,
  `run_input_snapshots`, guarded by `reject_run_input_snapshot_mutation`) — **but no code
  assembles either**. Nothing compiles messages, persona, memory, tool grants, budgets, or the
  digest.
- The two shapes **diverge**: the contract carries resolved outputs (`messageIds`,
  `memoryFacts`, `artifactRevisionIds`, `capabilitySetDigest`), while the Prisma model carries
  policy inputs (`modelRoute`, `toolGrantIds`, `memoryQueryPolicy`, `budgetPolicy`,
  `promptCompilerVersion`). They were authored independently and have never been reconciled.
- Persona loading exists only as `_LoadApprovalSnapshot`
  (`libs/backend/server/personas/main/src/prisma-persona-authority.ts`) — evidence loaded *for
  the approval decision*, as a side effect of the approval path. There is no "load the approved
  persona for a run" step anywhere.

The decision: define **one named, holistic flow** with a single entry point that deterministically
assembles everything a run needs into the `RunInputSnapshot`. Persona loading becomes one clearly
named step inside it. Approval stays a separate **upstream gate** that feeds the flow — a persona
must already be approved to be loadable; the flow never approves anything.

## The flow at a glance

Name: **session assembly**. One entry point, one output.

```
                         (upstream gates — NOT part of this flow)
   persona interview ─▶ PersonaRevision approved      grants/membership written
                                   │                            │
═══════════════════════════════════╪════════════════════════════╪══════════════
                                   ▼                            ▼
 __AssembleRunInputSnapshot(command, authorities)     ← the single entry point
   1. _LoadRunAuthority          run, service, revision (locked, revalidated)
   2. _LoadApprovedPersona       the active approved PersonaRevision (or none for managed)
   3. _LoadThreadContext         thread + ordered prompt messages (+ context revision)
   4. _LoadPreferenceFacts       durable per-user preference facts
   5. _LoadMemoryScope           memory datasets + query policy + pinned fact references
   6. _LoadToolPolicy            integration/skill assignments + tool grants
   7. _LoadBudgets               run budget policy (tokens, cost, time, tools)
   8. _LoadIdentityEnvelope      execution subject, fleet-membership revision,
                                 capability-set digest
   9. _CompileSnapshot           pure: canonicalize → digest → RunInputSnapshot
  10. _PersistSnapshot           immutable row + digest stamped onto the run
═══════════════════════════════════════════════════════════════════════════════
                                   │
                                   ▼
                    outbox: run.attempt_requested (existing path)
                    runtime receives the immutable snapshot only
```

Steps 1–8 are **loaders**: each a named, individually testable port with one read
responsibility. Step 9 is a **pure function** (no I/O). Step 10 is the only write.

## Requirements (normative)

### R1 — one entry point

`__AssembleRunInputSnapshot(command, authorities)` is the only way a `RunInputSnapshot` comes to
exist. No route, reconciler, or test fixture may compose snapshot fields ad hoc. The function is
invoked at run admission — after authorization (effective access) has accepted the run request
and before the `run.attempt_requested` outbox event is published.

- `command`: `{ runId, attempt, siloId, threadId, requestedAt }` — coordinates only, no content.
- `authorities`: the loader ports (below), injected so each is separately fakeable.

### R2 — deterministic output

Same durable inputs ⇒ byte-identical snapshot ⇒ identical digest.

- The digest is `sha256:<hex>` over the **RFC 8785 canonical JSON** of the complete snapshot
  (reuse `__DigestCanonicalJson`; no ad-hoc serialisation).
- No loader may read wall-clock time; `compiledAt` comes from the command's `requestedAt`.
- No unordered collections: messages in thread order, facts and grants sorted by stable id, all
  arrays explicitly ordered before canonicalisation.
- All loaders read inside **one transaction** with the repo's existing lock order (service →
  run → dependents), so the snapshot is a consistent cut, not a smear across concurrent writes.

### R3 — persona loading is a named step, approval is upstream

`_LoadApprovedPersona` loads the persona profile's **active, approved** `PersonaRevision` for a
personal agent (and yields "none" for managed agents without persona). It must:

- accept only `state = Approved` revisions reachable via `PersonaProfile.activeRevisionId`
  (the DB already guarantees active ⇒ approved; the loader still asserts it — defence in depth);
- return the compiled instructions and revision id, never template internals;
- **never** mutate persona state. Approval (`approveAndActivateAtomically`) remains where it is,
  on the persona authority, invoked from the approval surface. `_LoadApprovalSnapshot` stays what
  it is — approval evidence — and must not be reused as the run-time persona loader (different
  question, different locks, different failure modes).

Fail-closed: a personal agent whose profile has no active approved revision ⇒ typed refusal
`persona_unavailable`; the run is not admitted with a persona-less prompt.

### R4 — every input is a named, individually testable step

Each loader is a port (interface) with exactly one method and a typed result:

| Step | Port | Reads | Refusal reasons (minimum) |
|---|---|---|---|
| 1 | `RunAuthoritySource` | run + service + active published revision | `run_not_admittable`, `revision_unavailable` |
| 2 | `ApprovedPersonaSource` | active approved PersonaRevision | `persona_unavailable` |
| 3 | `ThreadContextSource` | thread, ordered messages, active context revision | `thread_unavailable` |
| 4 | `PreferenceFactSource` | durable preference facts for the subject | — (empty is valid) |
| 5 | `MemoryScopeSource` | authorised datasets, query policy, pinned `MemoryFactReference`s | `memory_scope_unavailable` |
| 6 | `ToolPolicySource` | revision's integration/skill assignments ∩ subject grants | `tool_policy_unavailable` |
| 7 | `BudgetPolicySource` | effective budget policy for run/service/silo | `budget_unavailable` |
| 8 | `IdentityEnvelopeSource` | execution subject, verified fleet-membership revision, capability-set digest | `membership_stale`, `identity_unavailable` |

Unit tests per loader; one composition test proving the assembler is a pure fold over the loader
results; one live-Postgres test proving the transaction cut + immutability trigger.

Note on step 4: no `PreferenceFact` model exists yet. The implementation slice must add it (or
consciously map it onto the memory catalog with `explicitUserStatement` provenance) — the spec
requires the *step* to exist with a stable port either way, so the flow shape does not change
when the backing model lands.

### R5 — one snapshot shape

Unify the divergent contract type and Prisma model into **one** canonical shape containing both
the policy inputs and the resolved outputs:

```
RunInputSnapshot {
  // coordinates
  runId, attempt, siloId, agentServiceId, agentRevisionId, snapshotVersion
  // resolved inputs (steps 2–8)
  personaRevisionId?          // step 2
  threadId, messageIds[]      // step 3 (ordered)
  preferenceFactIds[]         // step 4 (ordered)
  memoryQueryPolicy, memoryFacts[]        // step 5
  toolGrantIds[], skillRevisionIds[], artifactRevisionIds[]   // step 6
  budgetPolicy                // step 7
  identitySnapshot { executionSubjectId, fleetMembershipRevision }   // step 8
  capabilitySetDigest         // step 8
  modelRoute                  // step 6/7 boundary — server-selected route
  effectiveContractDigest, promptCompilerVersion
  // integrity
  digest                      // sha256 over the canonical whole (excluding itself)
  compiledAt                  // from command.requestedAt
}
```

The Prisma model is already close; the TS contract in `libs/contracts` is regenerated from this
shape and the old thin contract deleted (no compat alias — repo rule). `AgentRun.
inputSnapshotDigest` and the existing composite FK stay the binding.

### R6 — fail-closed, no partial snapshot

Any loader refusal aborts the whole assembly with a typed reason; nothing is persisted; the run
is not admitted (or the attempt not started). There is no "snapshot with gaps". The refusal
reason lands on the run admission response and the audit trail, not in a log line only.

### R7 — placement and naming (D5-final paths)

The flow is personal-agent product code. Per decision D5 it lands under the agent namespace:

- `libs/backend/agents/personal/session/main` — the assembler, ports, pure compile step.
- Loaders that wrap existing authorities (persona, runs, conversations, memory) are thin adapters
  in the same package importing those domain libs; they do not duplicate authority logic.
- The app (`apps/opencrane`) composes the ports with Prisma adapters at bootstrap, as usual.

### R8 — documentation

The flow is the "session creation" narrative in the website chapter
(`website/security-architecture/run-lifecycle.md`, snapshot section) — update its status note
when the assembler lands. Package README per the D-scope README standard: what it owns (session
assembly), its boundary (reads authorities, writes only the snapshot), dependency direction.

## Sequencing & interactions

- **After** D5 (namespace split) — the package is born at its final path.
- **Feeds** the Phase E runtime lane: the conformance harness (#246) consumes the snapshot as the
  run's immutable input; the steering design's rule "`RunInputSnapshot` stays immutable; absorbed
  steering is an append-only supplement" is unchanged by this spec.
- **Does not** change approval, capability issuance, or the controller protocol.

## Acceptance criteria

1. One exported entry point; grep proves no other writer of `run_input_snapshots`.
2. Ten named steps visible in code as named ports/functions (not one 400-line function).
3. Determinism test: two assemblies over the same fixture rows produce identical digests;
   reordering unordered source rows does not change the digest.
4. Fail-closed tests per refusal reason in R4's table, including `persona_unavailable` for a
   personal agent with an unapproved draft only.
5. Live-Postgres test: persisted snapshot row is immutable (trigger fires on UPDATE) and the
   run's `inputSnapshotDigest` matches the row.
6. Old thin contract type removed; single shape exported from `libs/contracts`.
