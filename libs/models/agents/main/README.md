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
  canonical `GrantScope`/`GrantSubjectType` vocabulary, and a positive per-run cost ceiling in USD
  micros), an `AgentRun` (one execution attempt), the
  conversation record — `Thread`, `Message`, `RunEvent` — and the `Persona` family (the saved
  personality and onboarding interview an agent runs with).
- A **pure revision diff** (`__DiffAgentRevisions`): line-level prompt diff plus semantic
  field-level configuration diff, flagging security-relevant widening (broader scopes, tools,
  credentials, or budgets) for reviewer confirmation. It reads only stable references, never secrets.
- **Pure decision functions** over those types:
  - `state-transitions` holds the small lookup tables of which state may legally follow which (for
    example a run may go `running → completed` but never `completed → running`), and answers a plain
    yes/no for a proposed move. Cancellation is deliberately two-phase: every active state moves to
    nonterminal `cancelling`, and only completed workload cleanup may move it to `cancelled`. It also
    checks that persisted run events form one gap-free sequence.
  - `persona-onboarding` turns a draft persona into an approved, runnable one: it validates the
    interview question set, checks every required category is answered, selects a template, and
    builds the runtime input — returning a typed success/failure result, never throwing.

Used by the agent-services backend, the personal-agent backends, and re-exported through
`@opencrane/contracts`. Invariant: transitions are **fail-closed** — only an explicitly listed next
state is allowed, cancellation cannot skip cleanup, and an incompletely evidenced persona can never
be approved. Because it is pure, the caller owns all persistence; a wrong answer here can only refuse
a legal move, never invent one.

## Public surface

- Lifecycle types: `AgentService`/`…State`, `AgentRevision`/`…State`, `AgentRun`/`…State`,
  `RevisionScopeAttachment`, `GrantScope`, `GrantSubjectType`, `Thread`, `Message`, `RunEvent`, and
  the `*Id` identifier aliases.
- Revision diff: `__DiffAgentRevisions` and its `AgentRevisionDiff` result types.
- Persona types: `PersonaOnboarding`, `PersonaInterview`, `PersonaRevision`, `SoulTemplate`,
  `PersonaResult` and their inputs.
- `__Is…TransitionAllowed`, `__CanAppendRunEvent` — the guard functions over the transition tables.
- `__CreatePersonaDraft`, `__ApprovePersonaOnboarding`, `__SelectSoulTemplate`,
  `__BuildPersonaRuntimeInput`, … — the pure persona onboarding/approval functions.

## Boundary

Pure and I/O-free: it defines and decides, but callers do the reading and writing. It does not know
about Kubernetes, HTTP, or Prisma.

## Dependency direction

Tagged `scope:agents` (`layer:model`): it may depend only on other `scope:agents` and `scope:shared`
packages — never on apps, backend domains, or other model domains.

## See also

- Parent index: [models](../../README.md)
- Siblings: [artifacts](../../artifacts/main/README.md) · [authorization](../../authorization/main/README.md) · [platform-policy](../../platform-policy/main/README.md)
