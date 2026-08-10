# @opencrane/models/agents — agent-domain types and lifecycle rules

> [models](../../README.md) › agents

## What it owns

A **model** package is shared TypeScript types plus pure decision functions — no database, no
network, no side effects. This one is the vocabulary of the **agent domain**: the shapes and rules
that describe an AI agent's life without saying where anything is stored.

It owns two kinds of thing:

- **Types** for an `AgentService` (a named, reusable agent), its immutable `AgentRevision`
  (a published, frozen version of that agent, carrying revision lineage — `parentRevisionId`,
  `sourceRevisionId`, `changeMessage` — and revision-scoped `RevisionScopeAttachment`s over the
  canonical `GrantScope`/`GrantSubjectType` vocabulary), an `AgentRun` (one execution attempt), and
  the ordered `RunEvent` emitted by that attempt.
- A **pure revision diff** (`__DiffAgentRevisions`): line-level prompt diff plus semantic
  field-level configuration diff, flagging security-relevant widening (broader scopes, tools,
  credentials, or budgets) for reviewer confirmation. It reads only stable references, never secrets.
- A **canonical revision digest** (`__DigestAgentRevisionContent`) over the complete
  `AgentRevisionContent`. Every revision-writing authority hashes the same domain value it persists,
  so managed and personal revision paths cannot silently disagree about executable content.
- **Reviewed integration tool definitions**: revision authoring freezes each tool's name,
  description, object input schema, and canonical schema digest. The shared validator rejects
  missing, malformed, duplicate, or digest-mismatched definitions before publication.
- **Pure decision functions** over those types:
  - `state-transitions` holds the small lookup tables of which state may legally follow which (for
    example a run may go `running → completed` but never `completed → running`), and answers a plain
    yes/no for a proposed move. Cancellation is deliberately two-phase: every active state moves to
    nonterminal `cancelling`, and only completed workload cleanup may move it to `cancelled`. It also
    checks that persisted run events form one gap-free sequence.

Used by the agent-services backend, the personal-agent backends, and re-exported through
`@opencrane/contracts`. Invariant: transitions are **fail-closed** — only an explicitly listed next
state is allowed and cancellation cannot skip cleanup. Because it is pure, the caller owns all
persistence; a wrong answer here can only refuse a legal move, never invent one.

## Public surface

- Lifecycle types: `AgentService`/`…State`, `AgentRevision`/`…State`, `AgentRun`/`…State`,
  `AgentServiceKinds`, `AgentServiceStates`, `AgentRevisionContent`, `RevisionScopeAttachment`, `GrantScope`,
  `GrantSubjectType`, `RunEvent`, `RunEventTypes`, and the agent/run `*Id` identifier aliases.
- Revision invariants: `__DigestAgentRevisionContent`, `__DiffAgentRevisions`, and the
  `AgentRevisionDiff` result types.
- `__Is…TransitionAllowed`, `__CanAppendRunEvent` — the guard functions over the transition tables.

## Boundary

Persistence- and network-free: it defines, decides, and deterministically hashes canonical agent
values, but callers do the reading and writing. Conversation mode, lifecycle, participants, messages,
and timeline ordering belong to the sibling conversations model. This package does not know about
Kubernetes, HTTP, or Prisma.

## Dependency direction

Tagged `scope:agents` (`layer:model`): it may depend on the lower conversation identifier contract
and other explicitly allowed model/shared packages — never on apps or backend domains.

## See also

- Parent index: [models](../../README.md)
- Siblings: [conversations](../../conversations/main/README.md) · [artifacts](../../artifacts/main/README.md) · [authorization](../../authorization/main/README.md)
