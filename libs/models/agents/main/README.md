# @opencrane/models/agents — agent-domain types and lifecycle rules

> [models](../../README.md) › agents

## What it owns

A **model** package is shared TypeScript types plus pure decision functions — no database, no
network, no side effects. This one is the vocabulary of the **agent domain**: the shapes and rules
that describe an AI agent's life without saying where anything is stored.

It owns two kinds of thing:

- **Types** for an `AgentService` (a named, reusable agent), its immutable `AgentRevision`
  (a published, frozen version of that agent, carrying revision lineage — `parentRevisionId`,
  `sourceRevisionId`, `changeMessage` — and revision-scoped `RevisionBoundaryAttachment`s over
  stored Group or Personal knowledge boundaries), an `AgentRun` (one durable root execution),
  and each globally ordered `RunEvent` bound to its immutable attempt.
- A **pure revision diff** (`__DiffAgentRevisions`): line-level prompt diff plus semantic
  field-level configuration diff, flagging security-relevant widening (broader knowledge boundaries, tools,
  or budgets) for reviewer confirmation. It reads only stable references, never secrets.
- A **canonical revision digest** (`__DigestAgentRevisionContent`) over the complete
  `AgentRevisionContent`. Every revision-writing authority hashes the same domain value it persists,
  so managed and personal revision paths cannot silently disagree about executable content.
- The exact `AgentBudget` stored with each revision and `__ParseAgentBudget`, its fail-closed
  parser. The budget fixes total model calls, tokens, tool calls, elapsed time and saved tool-result
  cycles for one run. Its nullable revision cost can add a tighter cap, while null leaves the
  separately configured spend cap in force.
- The pure calendar rules for confirmed routines: numeric five-field cron in an Internet Assigned
  Numbers Authority (IANA) timezone, with missing local times skipped and repeated local times used
  once at their earliest Coordinated Universal Time (UTC) instant.
- Pure firing selection from a caller-supplied database clock. Automatic recovery selects the latest
  due slot, skips overlap and consumes that slot; manual firing ignores pause and overlap without
  changing the automatic cursor.
- **Pure decision functions** over those types:
  - `state-transitions` holds the small lookup tables of which state may legally follow which (for
    example a run may go `running → completed` but never `completed → running`), and answers a plain
    yes/no for a proposed move.

Used by the agent-services backend, the personal-agent backends, and re-exported through
`@opencrane/contracts`. Invariant: transitions are **fail-closed** — only an explicitly listed next
state is allowed. Because it is pure, the caller owns all
persistence; a wrong answer here can only refuse a legal move, never invent one.

## Public surface

- Lifecycle types: `AgentService`/`…State`, `AgentRevision`/`…State`, `AgentRun`/`…State`,
  `AgentServiceKinds`, `AgentServiceStates`, `AgentRevisionContent`, `RevisionBoundaryAttachment`,
  `RevisionBoundaryKinds`, `RevisionBoundaryCoverages`, `RunEvent`, `RunEventTypes`, and the
  agent/run `*Id` identifier aliases.
- `RunEventTypes` is the closed durable vocabulary for streamed messages, tool lifecycle and failure,
  usage, display-safe runtime errors, terminal outcomes, and versioned governed A2UI updates.
- `PERSONAL_MEMORY_RECALL_TOOL_NAME` is the provider-safe model-visible name, while
  `PERSONAL_MEMORY_RECALL_TOOL_REVISION` is the dependency-neutral identity used by admission,
  elicitation, and execution for the built-in personal-memory recall tool.
- `AgentRunStates` is the documented string-backed run lifecycle vocabulary used by runtime
  admission instead of repeated categorical literals. `AgentRunTriggers` distinguishes an
  interactive request from an automatic or manual routine occurrence.
- `ExecutionSubjectMembershipKinds` distinguishes signed human Fleet membership, local Standalone
  human membership and current managed service authority. `ExecutionSubject` always carries the requester's separate human membership
  evidence. `___ExecutionSubjectSchema` and `___StandaloneMembershipSchema` validate these shapes beside
  the model and reject unknown fields; current authority checks remain with IAM. Standalone evidence
  freezes the local membership row/version and an observation deadline without inventing a signature
  or Fleet revision.
- Revision invariants: `__DigestAgentRevisionContent`, `__DiffAgentRevisions`, and the
  `AgentRevisionDiff` result types. `__ParseAgentBudget` rejects missing, extended or invalid
  saved budget JSON before a new revision can copy or hash it. Increasing a numeric ceiling, or
  removing a revision cost cap, is a budget widening.
- Routine calendar and firing contracts: `RoutineSchedule`, `RoutineStatus`,
  `RoutineFiringTrigger`, `RoutineFiringDisposition`, `__ParseRoutineSchedule`,
  `__NextRoutineOccurrence`, `__LatestRoutineOccurrence`, `__PreviewRoutineOccurrences`, and
  `__PlanRoutineFiring`.
- `__Is…TransitionAllowed` — the guard functions over the service, revision, and run transition tables.

## Boundary

Persistence- and network-free: it defines, decides, and deterministically hashes canonical agent
values, but callers do the reading and writing. Conversation mode, lifecycle, participants, messages,
and timeline ordering belong to the sibling conversations model. This package does not know about
Kubernetes, HTTP, or Prisma. The routine planner does not authorize a firing or advance a cursor;
the scheduling backend must lock current state and save its decision atomically.

The routine lifecycle uses this State × Event table before permission checks and persistence:

| Saved status | Automatic timer | Manual run now | Atomic authority |
|---|---|---|---|
| Active | Select the latest due slot; skip it when work is unfinished | Prepare immediately, even while work is unfinished | Scheduling backend |
| Paused | Do nothing and keep the cursor | Prepare immediately | Scheduling backend |
| Retired | Do nothing | Save a refusal | Scheduling backend |

Creation, resume and revision replacement set the automatic enabled boundary from the database
clock. The planner therefore cannot replay time before that boundary. `Preparing` means a firing
claim exists before run admission; it never means execution has started.

## Dependency direction

Tagged `scope:agents` (`layer:model`): it may depend on the lower conversation identifier contract
and other explicitly allowed model/shared packages — never on apps or backend domains.

## See also

- Parent index: [models](../../README.md)
- Siblings: [conversations](../../conversations/main/README.md) · [artifacts](../../artifacts/main/README.md) · [authorization](../../authorization/main/README.md)
