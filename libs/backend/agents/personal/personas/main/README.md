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

**In this flow:** [runs](../../../execution/runs/main/README.md) *(runs execute against the persona this activates)*

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

Every lifecycle adapter returns the same serialized lifecycle outcome and denial values through
documented string-backed enums. That keeps the API's readable response values stable while ensuring
the profile, interview, drafting, and approval owners cannot silently drift into different control
flow vocabularies. Reviewed templates require unique rule priorities within each template, so
delegate-backed drafting never substitutes application collation for a database rule-ID tie-break.

Invariant: onboarding evidence is append-only until completion, and only a fully evidenced draft
becomes active. The approval swap rebinds every precondition at commit time, so a concurrent edit
fails closed and a crash leaves the previous active persona intact, never a half-approved one. When
the interview was started by an accepted refresh proposal, the approval transaction must still find
and apply that exact proposal; a missing or concurrently changed proposal rejects and rolls back the
whole approval rather than activating the revision alone.

## Public surface

- `__CreatePersonaOnboardingRouter` — the API-first self-persona surface. It starts ordinary or
  proposal-bound refresh interviews, records one answer, and completes them using only
  session-and-host-derived ownership.
- `_CreatePersonaOnboardingRouter` — the ready-to-mount Prisma composition. It maps the shared
  request principal to the persona caller and owns every onboarding repository and the clock.
- `_PersonaOnboardingOpenapiPaths` — the OpenAPI paths for that owner-only router.
- `PersonaOnboardingCaller`, `PersonaOnboardingClock`, and
  `PersonaOnboardingRouterDependencies` — the three types needed to compose the router without
  exposing the lifecycle authorities or persistence adapters.

## Boundary

Consumed by the persona-onboarding path. It owns the interview lifecycle and approval, but does not
execute the agent. Its drafting authority derives bounded owner-visible insight statements, template
selection, and every durable draft coordinate from one serializable completed-interview snapshot. It never
activates a draft that is not fully evidenced, and it never mints an editable runtime persona file.
The capability stays one aggregate lifecycle, but its implementation is grouped by responsibility:
`profile/` provisions and reports owner state, `interview/` records immutable answers, `drafting/`
derives reviewable evidence, `approval/` activates the revision, and `http/` adapts the owner-only
API. The route module composes these owners; it contains no persistence policy.

The lifecycle functions, their command/result types, repository ports, Prisma repositories, local
catalogue, persistence unit of work, and status adapter are internal cohesive owners. `profile/`
owns profile provisioning and status, `interview/` owns append-only evidence, `drafting/` owns draft
derivation, `approval/` owns activation, and `http/` alone exposes the public router composition.
Callers cannot bypass that composition through the package barrel.

## Dependency direction

Tagged `scope:personal-personas`: it may depend on its own scope, `scope:shared`, and the narrow
`scope:auth` request-principal seam. It also has one intentional sibling dependency on
`scope:personal-configuration`: the configuration-owned
`PersonalConfigurationPersonaRefreshUnitOfWork` claims the exact accepted refresh proposal and joins
persona persistence to its transaction. This package never reads or writes
`PersonalConfigurationChange` itself and imports no other sibling business domain. It never depends
on an app.

## Data & persistence

Provisions one `PersonaProfile` for each authenticated `(silo, user)` pair and the initial immutable
`PersonaQuestionSet` / `PersonaQuestion` / `PersonaSoulTemplate` catalogue in the canonical product
database. It also starts, appends answers to, and completes `PersonaInterview` and
`PersonaInterviewAnswer` rows; reads a joined approval snapshot (profile · revision · interview ·
template · insights); and commits approval plus the active-persona pointer in one transaction. A
configuration-owned unit of work joins a proposal-bound refresh to that same transaction: persona
persistence retains only the opaque change identifier and never reads or writes
`PersonalConfigurationChange` directly.
Postgres-level lifecycle behaviour is exercised by the `test:sql` target
(`src/approval/__tests__/persona-authority.sql`).
On a clean database, the target baseline supplies one reviewed eight-question onboarding set and two
reviewed `SOUL.md` templates. The relationship and challenge answers select the direct or supportive
template deterministically; profiles and interview evidence remain user-owned runtime records.

## See also

- Parent index: [agents](../../../README.md)
- Related authorities: [conversation replay](../../../../server/agents/conversation-replay/main/README.md) · [memory](../../memory/main/README.md) · [runs](../../../execution/runs/main/README.md)
