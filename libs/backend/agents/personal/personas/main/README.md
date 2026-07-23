# @opencrane/backend/agents/personal/personas — persona approval process

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › personas

## What it owns

This package is part of the **personal-agent product**. A **persona** is the saved personality and
instructions an agent runs with — who it is and how it should behave. A user builds one through an
onboarding interview, producing a **draft**. This package owns the **approval process** end to end:
the checks that turn a fully evidenced draft into the single live persona, atomically.

```
 draft persona
     │ 1. interview          capture the onboarding Q&A
     ▼
     │ 2. snapshot           gather the approval evidence
     ▼                       (owner · 3–5 insights · exact template used)
     │ 3. validate ─────────► evidence incomplete?  →  denied
     ▼
     │ 4. approve + activate atomically swap in the new persona
     ▼
 active persona
```

**In this flow:** [runs](../../runs/main/README.md) *(runs execute against the persona this activates)*

Step 3 is where the strictness lives. From one consistent database snapshot the use case confirms:
the caller owns the profile; the revision is still a `draft`; the interview is `completed`; there are
between **three and five** provenance-linked insights; the reviewed template's fingerprint (digest)
still matches and its selection rule still matches the interview answers; and the policy forbidding a
mutable runtime "SOUL" file (a legacy editable personality file — deliberately not created here) holds.
Any failure is a specific denial (`not_draft`, `interview_incomplete`, `invalid_insights`,
`template_mismatch`, …).

Invariant: only a fully evidenced draft becomes active, and the swap is atomic — step 4 rebinds every
precondition at commit time, so a concurrent edit fails closed and a crash leaves the previous active
persona intact, never a half-approved one.

## Public surface

- `__ApprovePersona(repository, command)` — the single use case: validate evidence, then approve and activate atomically.
- `ApprovePersonaCommand` / `ApprovePersonaResult` — the request and the stable allow/deny outcome.
- `PersonaApprovalSnapshot` — the consistent evidence read before the decision.
- `AtomicApprovePersonaCommand` / `AtomicApprovePersonaResult` — the commit command carrying the accepted preconditions, and its raw result.
- `PersonaAuthorityRepository` — the persistence port a caller must implement (or inject).
- `PrismaPersonaAuthorityRepository` — the target Postgres implementation; it locks the profile,
  approves the checked draft, and moves the active pointer in one transaction.

## Boundary

Consumed by the persona-onboarding path. It only approves — it does not run the interview, generate
insights, or execute the agent. It never activates a draft that is not fully evidenced, and it never
mints an editable runtime persona file. Storage is injected through `PersonaAuthorityRepository`.

## Dependency direction

Tagged `scope:personal-personas`: it may depend only on `scope:personal-personas` and `scope:shared`
— never on apps or sibling domains.

## Data & persistence

Reads a joined snapshot (profile · revision · interview · template · insights) and commits the
approval plus the active-persona pointer in one transaction through the injected repository.
Postgres-level behaviour is exercised by the `test:sql` target (`tests/persona-authority.sql`).

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [conversations](../../conversations/main/README.md) · [memory](../../memory/main/README.md) · [runs](../../runs/main/README.md)
