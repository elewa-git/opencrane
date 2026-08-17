# @opencrane/backend/agents/personal/personas — persona interview and approval process

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › personas

## What it owns

This package is part of the **personal-agent product**. A **persona** is the saved personality and
instructions an agent runs with — who it is and how it should behave. A user builds one through an
onboarding interview, producing a **draft**. An accepted persona-refresh proposal starts the same
interview with its proposal identity permanently recorded; approving the resulting revision applies
that exact proposal. This package owns the full durable lifecycle: it starts
an interview from a reviewed question set, captures each choice once, freezes the completed evidence,
computes and resolves the weighted colour/modifier result, compiles the matching reviewed template,
and then approves a fully evidenced draft into the single live persona.

```
server-owned reviewed question set
     │ 0. provision          create one owner profile and load the current product catalogue
     │ 1. start              bind one exact reviewed version to the owner profile
     ▼
 interview in progress
     │ 2. answer             append each answer once, with question provenance
     ▼
 completed interview
     │ 3. score + resolve    replay weights; append explicit choices for any ties
     ▼
 resolved result
     │ 4. compile draft      pin source digests + 3–5 answer-linked insights
     ▼
 draft persona
     │ 5. approve + activate atomically swap in the new persona
     ▼
 active persona
```

**In this flow:** [runs](../../../execution/runs/main/README.md) *(runs execute against the persona this activates)*

The interview half runs every start inside one serializable transaction, so duplicate browser
requests reuse the one in-progress interview instead of discarding answers, and two racing starts
resolve as one interview plus one retriable conflict. A retry of the same proposal-bound refresh
returns that interview and its frozen questions again; a different refresh proposal receives a
conflict instead of hijacking it. A missing or wrong-owner refresh proposal returns the same
non-disclosing `404`; the transport never reveals which condition applied. Each answer and the completion re-read the interview inside the
same serializable boundary, so a late answer cannot race a completed record. Answers name the exact question-set
revision and question they answered; completion is refused until every question in that reviewed
revision has exactly one answer.

A retake is a new interview rather than a rewrite of an old one. The owner profile, user, reviewed
question-set version, and start instant are fixed at creation, so a later refresh preserves the
earlier interview as evidence instead of changing who answered which questions.

The approval half takes one consistent database snapshot and confirms the caller owns the profile;
the revision is still a `draft`; the interview is `completed`; there are between **three and five**
provenance-linked insights; the immutable weighted score, explicit tie evidence, reviewed source
digests, selected colour/modifier template, and interpolation inputs all replay exactly; and the
policy forbidding a mutable runtime "SOUL" file holds. Any failure is a specific denial
(`not_draft`, `interview_incomplete`, `invalid_insights`,
`template_mismatch`, …).

An interrupted HTTP response can be retried safely after approval commits: the authority accepts an
already-approved revision only when it is still the exact active revision of the same owner profile.
Status reads also re-emit the current owner-bound interview notification. Before accepting that
notification, the workflow coordinator reconciles any already-approved persona for its durable
pinned interview, so a newer interview cannot hide the only evidence that advances onboarding.
Persona refreshes after initial onboarding remain persona-owned maintenance and do not rewind the
separate `UserOnboarding` route state.

Every lifecycle adapter returns the same serialized lifecycle outcome and denial values through
documented string-backed enums. That keeps the API's readable response values stable while ensuring
the profile, interview, drafting, and approval owners cannot silently drift into different control
flow vocabularies. Ties never fall back to template order or application collation: the owner must
append the exact required primary, secondary, or modifier choice before drafting can proceed.
The status adapter parses the complete immutable scoring-evidence document before projecting a draft
for review and rejects mismatched totals, classifications, tie categories, or insight bounds. The
stored initial primary, secondary, and modifier candidate sets are replayed independently of later
append-only tie choices, so persisted provenance cannot drift while a resolved score advances.

Invariant: onboarding evidence is append-only until completion, and only a fully evidenced draft
becomes active. The approval swap rebinds every precondition at commit time, so a concurrent edit
fails closed and a crash leaves the previous active persona intact, never a half-approved one. When
the initial onboarding survey is still open, the database also requires the approving revision to
come from its currently pinned interview. Conversely, that pin cannot be replaced after its persona
became active; either ordering of an approval-versus-sort-again race therefore rejects the stale
operation. When the interview was started by an accepted refresh proposal, the approval transaction
must still find and apply that exact proposal. Before the profile pointer or proposal journal moves,
the same transaction asks the agent-service strategy to publish a persona-only AgentRevision and
append its audit evidence. An owner without a personal AgentService remains a valid no-op; stale,
missing, or ambiguous agent authority rejects and rolls back the whole approval.

## Public surface

- `__CreatePersonaOnboardingRouter` — the API-first self-persona surface. It starts ordinary or
  proposal-bound refresh interviews, records one answer, and completes them using only
  session-and-host-derived ownership.
- `_CreatePersonaOnboardingRouter` — the ready-to-mount Prisma composition. It maps the shared
  request principal to the persona caller and supplies one aggregate persistence unit of work and the clock.
- `_CreatePersonaWorkflowEvidenceRepository` — the narrow owner-bound evidence reader used by the
  server-tracked onboarding authority; it exposes the exact pinned approved revision's reviewed
  display name and safe `PersonaWorkflowColours` value even after a later refresh becomes active,
  never compiled instructions. The raw Prisma adapter remains internal.
- `PersonaOnboardingWorkflowPort` — the narrow app-composed notification boundary that advances the
  distinct durable onboarding authority after an owner starts an interview or approves a persona.
- `PersonaAgentRevisionSelectionFactory` and `PersonaAgentRevisionSelectionPort` — the narrow
  app-owned bridge that binds agent-service persona selection to the approval transaction without
  giving this package AgentService persistence authority.
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

`PrismaPersonaPersistenceUnitOfWork` is the sole owner of persona transaction creation. For each
operation it constructs the lifecycle repositories once with the exact callback transaction; the
app-created persona-selection port receives that same callback transaction. The repositories cannot
retain or receive the root Prisma client. The aggregate read repository in
`profile/` owns shared lifecycle evidence reads and next-revision allocation. It takes no row locks,
so a concurrent writer surfaces as an explicit conflict outcome instead of a blocked lock. Scoring
owns immutable weighted-vector replay and append-only tie choices. Drafting selects the reviewed
template by resolved primary colour and modifier, applies only the pinned interpolation map, and
stores the exact source identities, digests, score evidence, and answer provenance in the revision.
Before drafting, the API exposes a generic result label; only the draft/status projection may expose
the reviewed template's display name.

The lifecycle functions, their command/result types, repository ports, Prisma repositories, local
catalogue, persistence unit of work, and status adapter are internal cohesive owners. `profile/`
owns profile provisioning and status, `interview/` owns append-only evidence, `drafting/` owns draft
derivation, `approval/` owns activation, and `http/` alone exposes the public router composition.
Callers cannot bypass that composition through the package barrel.

## Dependency direction

Tagged `scope:personal-personas`: it may depend on its own scope, `scope:shared`, and the narrow
`scope:auth` request-principal seam. It also has one intentional sibling dependency on
`scope:personal-configuration`: the configuration-owned
`PrismaPersonalConfigurationPersonaRefreshRepository` claims and applies the exact accepted refresh
proposal on the persona unit of work's transaction. Configuration retains delegate ownership; this
package imports no other sibling business domain and never depends on an app.

## Data & persistence

Provisions one `PersonaProfile` for each authenticated `(silo, user)` pair and the reviewed
`PersonaQuestionSet`, choices, scoring policy/weights, interpolation map, and `PersonaSoulTemplate`
catalogue in the canonical product database. It starts, answers, and completes `PersonaInterview`
rows; persists one immutable `PersonaInterviewScore` plus append-only `PersonaTieResolution`
evidence; creates provenance-linked revisions and insights; and commits approval plus the
active-persona pointer in one transaction. A
configuration-owned repository joins a proposal-bound refresh to that same transaction: persona
logic retains only the opaque change identifier and never accesses `PersonalConfigurationChange`
through a Prisma delegate.
Postgres-level lifecycle behaviour is exercised by the `test:sql` target. Its authority assertions
live in `src/approval/__tests__/persona-authority.sql`; a two-session race test also proves both
approval-first and replacement-first outcomes complete without a deadlock and retain one winner.
On a clean database, the target baseline supplies one reviewed ten-question choice catalogue, its
weighted scoring and interpolation sources, and eight reviewed colour/modifier SOUL templates.
Profiles, interviews, scores, tie choices, revisions, and approval evidence remain user-owned runtime
records. Profile provisioning supplies its opaque identifier explicitly on the native upsert path;
it does not rely on an ORM-side default for a database column that deliberately has no SQL default.

## See also

- Parent index: [agents](../../../README.md)
- Related authorities: [conversation replay](../../../../server/conversations/main/README.md) · [memory](../../memory/main/README.md) · [runs](../../../execution/runs/main/README.md)
