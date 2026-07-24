# @opencrane/backend/agents/personal/personas — persona interview and approval process

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › personas

## What it owns

This package is part of the **personal-agent product**. A **persona** is the saved personality and
instructions an agent runs with — who it is and how it should behave. A user builds one through an
onboarding interview, producing a **draft**. This package owns the full durable lifecycle: it starts
an interview from a reviewed question set, captures each answer once, freezes the completed evidence,
derives a draft from selected-template evidence, and then approves a fully evidenced draft into the
single live persona.

```
 reviewed question set
     │ 1. start              bind one exact reviewed version to the owner profile
     ▼
 interview in progress
     │ 2. answer             append each answer once, with question provenance
     ▼
 completed interview
     │ 3. derive draft       record 3–5 insights + exact SOUL template selection
     ▼
 draft persona
     │ 4. approve + activate atomically swap in the new persona
     ▼
 active persona
```

**In this flow:** [runs](../../runs/main/README.md) *(runs execute against the persona this activates)*

The interview half locks the profile while it starts, so duplicate browser requests reuse the one
in-progress interview instead of discarding answers. It locks that interview again for each answer
and for completion, ensuring a late answer cannot race a completed record. Answers name the exact
question-set revision and question they answered; completion is refused until every question in that
reviewed revision has exactly one answer.

The approval half takes one consistent database snapshot and confirms the caller owns the profile;
the revision is still a `draft`; the interview is `completed`; there are between **three and five**
provenance-linked insights; the reviewed template's fingerprint (digest) and selection rule still
match the interview answers; and the policy forbidding a mutable runtime "SOUL" file holds. Any
failure is a specific denial (`not_draft`, `interview_incomplete`, `invalid_insights`,
`template_mismatch`, …).

Invariant: onboarding evidence is append-only until completion, and only a fully evidenced draft
becomes active. The approval swap rebinds every precondition at commit time, so a concurrent edit
fails closed and a crash leaves the previous active persona intact, never a half-approved one.

## Public surface

- `__StartPersonaInterview`, `__RecordPersonaInterviewAnswer`, `__CompletePersonaInterview` — start,
  append to, and complete the reviewed onboarding interview lifecycle.
- `StartPersonaInterviewCommand` / `StartPersonaInterviewResult`,
  `RecordPersonaInterviewAnswerCommand` / `RecordPersonaInterviewAnswerResult`, and
  `CompletePersonaInterviewCommand` / `CompletePersonaInterviewResult` — the lifecycle requests and
  stable outcomes.
- `PersonaInterviewRepository` / `PrismaPersonaInterviewRepository` — the lifecycle persistence port
  and its canonical product-database implementation.
- `__CreatePersonaDraft(repository, command)` — derives the selected template, next revision, and
  answer provenance from a completed interview; callers supply only reviewable insight statements.
- `CreatePersonaDraftCommand` / `CreatePersonaDraftResult`, `CreatePersonaDraftPersistenceResult`,
  `PersonaDraftInsightCommand`, and `PersonaDraftRepository` — the request, stable outcome, raw
  persistence result, insight evidence, and draft persistence port.
- `PrismaPersonaDraftRepository` — locks profile and interview evidence, then persists the derived
  template and three-to-five answer-bound insights as one draft.
- `__ApprovePersona(repository, command)` — validates evidence, then approves and activates atomically.
- `ApprovePersonaCommand` / `ApprovePersonaResult` — the request and stable allow/deny outcome.
- `PersonaApprovalSnapshot`, `AtomicApprovePersonaCommand`, `AtomicApprovePersonaResult`, and
  `PersonaAuthorityRepository` — the consistent evidence and injected approval persistence boundary.
- `PrismaPersonaAuthorityRepository` — the target Postgres implementation; it locks the profile,
  approves the checked draft, and moves the active pointer in one transaction.
- `__CreatePersonaOnboardingRouter` — the authenticated HTTP composition for reading the reviewed
  questions, starting and answering an interview, deriving a draft, and approving it. It receives
  the OIDC subject and host-derived silo from the app; none of those ownership coordinates are HTTP
  inputs.
- `PrismaPersonaOnboardingRepository` — resolves the one profile for that server-derived caller and
  reads the clean-build reviewed onboarding source (`personal-agent-onboarding`, version 1).

## Boundary

Consumed by the persona-onboarding path. It owns the interview lifecycle and approval, but does not
 generate insights or execute the agent. Its HTTP router is deliberately only a parser and identity
 composition layer: it derives the person from the authenticated session, derives the silo from the
 request host, verifies an active membership in that exact silo, and resolves the profile server-side.
 It accepts only reviewable insight statements
and derives template selection plus every other durable draft coordinate from the completed
interview. It never activates a draft that is not fully evidenced, and it never mints an editable
runtime persona file. Storage is injected through its authority repositories.

## Dependency direction

Tagged `scope:personal-personas`: it may depend only on `scope:personal-personas` and `scope:shared`
— never on apps or sibling domains.

## Data & persistence

Starts, appends answers to, and completes `PersonaInterview` and `PersonaInterviewAnswer` rows in the
canonical product database. It also reads a joined approval snapshot (profile · revision · interview
· template · insights) and commits approval plus the active-persona pointer in one transaction.
Postgres-level lifecycle behaviour is exercised by the `test:sql` target (`tests/persona-authority.sql`).
On a clean database, the target baseline supplies one reviewed eight-question onboarding set and two
reviewed `SOUL.md` templates. The relationship and challenge answers select the direct or supportive
template deterministically; profiles and interview evidence remain user-owned runtime records.

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [conversations](../../conversations/main/README.md) · [memory](../../memory/main/README.md) · [runs](../../runs/main/README.md)
