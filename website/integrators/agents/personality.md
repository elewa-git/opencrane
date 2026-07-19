# Agent personality

Every personal assistant begins with a short onboarding interview that produces a reviewed,
versioned personality. The runtime receives that immutable revision; it does not own a mutable
`SOUL.md` or durable workspace persona.

> See also: [Agents overview](/integrators/agents/),
> [Retrieval & memory](/integrators/retrieval-memory), and
> [Organizational knowledge](/guide/knowledge).

::: info Implementation status
The `PersonaProfile`, `PersonaRevision`, interview and preference contracts are accepted. The
onboarding flow and runtime compiler are 🔶 planned for Phase E.
:::

## Onboarding creates the first revision

1. OpenCrane presents a versioned question set covering role, language, tone, structure,
   challenge-versus-support preference, initiative, approval boundaries, working habits, and memory
   boundaries.
2. The answers select a reviewed `SOUL.md` template and contribute three to five explicit insights,
   each linked to its source question.
3. The user previews the result and approves, edits, or retakes the interview.
4. Approval publishes the first immutable `PersonaRevision`. Only then can the first personal-agent
   run start.

`SOUL.md` is a template and authoring format, not live mutable product state. A later change creates
a new revision with provenance and review; it never silently rewrites an active run.

## Four compiled layers

Each accepted run receives a deterministic prompt compiled from four sources:

```
platform contract  security ceilings, budgets and non-editable behaviour
company layer      identity, terminology, values and shared conventions
personal layer     approved PersonaRevision and preference facts
run context        thread history, recalled memory, artifacts and temporary context
```

The accepted `RunInputSnapshot` pins the exact versions used. A company or persona update therefore
affects only later runs.

## Personality is not a security boundary

A persona may ask the model to be cautious, but it cannot make an unsafe tool safe or grant a new
permission. Authorisation, approval, credential custody, network policy and sandboxing sit outside
the prompt. Retrieved text, uploaded documents and MCP results are also untrusted content; they
cannot promote themselves into the platform or personality layers.

## Personality is not memory

Personality describes how the assistant should work with its user. Memory records facts and useful
context with provenance, scope and correction controls. OpenCrane may turn an explicit preference
such as “lead with the conclusion” into a visible candidate fact, but sensitive traits are not
silently inferred and personal memory never automatically becomes a company asset.

Cognee remains the durable memory/index plane. Runtime-local files are mounted scratch and are not
backed up or treated as persona or memory authority.
