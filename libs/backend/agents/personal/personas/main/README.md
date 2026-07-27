# @opencrane/backend/agents/personal/personas — persona interview and approval process

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › personas

## What it owns

This package is part of the **personal-agent product**. A **persona** is the saved personality and
instructions an agent runs with — who it is and how it should behave. A user builds one through an
onboarding interview, producing a **draft**. An accepted persona-refresh proposal starts the same
interview with its proposal identity permanently recorded; approving the resulting revision applies
that exact proposal. This package owns the full durable lifecycle: it starts
an interview from a reviewed question set, captures each answer once, freezes the completed evidence,
derives a draft from selected-template evidence, and then approves a fully evidenced draft into the
single live persona.

```
server-owned reviewed question set
     │ 0. provision          create one owner profile and load the current product catalogue
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
in-progress interview instead of discarding answers. A retry of the same proposal-bound refresh
returns that interview and its frozen questions again; a different refresh proposal receives a
conflict instead of hijacking it. The authority locks the interview again for each answer and for
completion, ensuring a late answer cannot race a completed record. Answers name the exact question-set
revision and question they answered; completion is refused until every question in that reviewed
revision has exactly one answer.

A retake is a new interview rather than a rewrite of an old one. The owner profile, user, reviewed
question-set version, and start instant are fixed at creation, so a later refresh preserves the
earlier interview as evidence instead of changing who answered which questions.

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
- `__EnsurePersonaOnboarding` — validates the authenticated owner coordinates before provisioning the
  owner profile and current reviewed interview source.
- `PersonaOnboardingRepository` / `PrismaPersonaOnboardingRepository` — the provisioning port and
target Postgres implementation. It creates the initial product catalogue only as `Draft`, fills all
required questions, then reviews it; a conflicting source identity fails closed. Its app-supplied
logger records handled database failures with the silo and error details, while a trace covers the
whole provisioning transaction.
- `PERSONA_ONBOARDING_QUESTION_SET_ID`, `PERSONA_ONBOARDING_QUESTION_SET_VERSION`,
  `PERSONA_ONBOARDING_QUESTIONS`, and `PERSONA_ONBOARDING_SOUL_TEMPLATES` — the reviewed catalogue
  source: eight key questions and three role-selected SOUL.md starting templates.
- `__CreatePersonaOnboardingRouter` — the API-first self-persona surface. It starts ordinary or
  proposal-bound refresh interviews, records one answer, and completes them using only
  session-and-host-derived ownership.

## Boundary

Consumed by the persona-onboarding path. It owns the interview lifecycle and approval, but does not
generate insights or execute the agent. It accepts only reviewable insight statements and derives
template selection plus every other durable draft coordinate from the completed interview. It never
activates a draft that is not fully evidenced, and it never mints an editable runtime persona file.
Storage is injected through its three authority repositories; the provisioning adapter also receives
the composing app's structured logger rather than creating a second logging root.

## Dependency direction

Tagged `scope:personal-personas`: it may depend only on `scope:personal-personas` and `scope:shared`
— never on apps or sibling domains.

## Data & persistence

Provisions one `PersonaProfile` for each authenticated `(silo, user)` pair and the initial immutable
`PersonaQuestionSet` / `PersonaQuestion` / `PersonaSoulTemplate` catalogue in the canonical product
database. It also starts, appends answers to, and completes `PersonaInterview` and
`PersonaInterviewAnswer` rows; reads a joined approval snapshot (profile · revision · interview ·
template · insights); and commits approval plus the active-persona pointer in one transaction.
Postgres-level lifecycle behaviour is exercised by the `test:sql` target (`tests/persona-authority.sql`).
On a clean database, the target baseline supplies one reviewed eight-question onboarding set and two
reviewed `SOUL.md` templates. The relationship and challenge answers select the direct or supportive
template deterministically; profiles and interview evidence remain user-owned runtime records.

## See also

- Parent index: [agents](../../../README.md)
- Related authorities: [conversation replay](../../../../server/agents/conversation-replay/main/README.md) · [memory](../../memory/main/README.md) · [runs](../../../execution/runs/main/README.md)
