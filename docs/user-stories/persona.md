# Persona user stories

## Feature intent

Let a person deliberately define and evolve how their personal agent collaborates. Persona changes
are reviewed, provenance-linked, immutable revisions rather than hidden prompt mutation.

Current status: `API ready` for the finite backend lifecycle, `UI missing`, `Design ready`. Only the
status read appears in the generated OpenAPI contract today.

## PER-01 — See persona readiness

**As an** Owner, **I want** to see whether my persona needs an interview, review, or no action **so
that** I can continue from the correct point.

Acceptance criteria:

- The UI distinguishes `interview`, `review`, and `ready`.
- Progress includes answered and total question counts without exposing another owner's records.
- Reloading resumes the active interview or review.

API: `GET /api/v1/me/persona`.

## PER-02 — Start or resume the governed interview

**As an** Owner, **I want** to start or resume the reviewed persona questionnaire **so that** my
preferences are captured against a stable question set.

Acceptance criteria:

- Starting twice reuses the one active interview instead of duplicating it.
- The current baseline covers role, tone/language, structure, challenge style, initiative, approval
  boundaries, working habits, and memory boundaries.
- Question order, required state, progress, long text, and validation are explicit.
- A missing reviewed question set is shown as configuration unavailable, not an empty interview.

API: `POST /api/v1/me/persona/interview`.

## PER-03 — Answer each persona question once

**As an** interview participant, **I want** each answer saved against the exact reviewed question
**so that** my evidence cannot silently move between versions.

Acceptance criteria:

- An answer is appended once and acknowledged before the next question is treated as complete.
- Empty, invalid, oversized, duplicate, conflict, and persistence-failure states are designed.
- The user can revisit already recorded answers as read-only evidence.

API: `POST /api/v1/me/persona/interviews/{interviewId}/answers/{questionId}`.

## PER-04 — Complete and review the interview

**As an** Owner, **I want** to complete the questionnaire and inspect the generated persona draft
**so that** I can verify what OpenCrane inferred before activation.

Acceptance criteria:

- Completion is unavailable until every required question is answered.
- Completion freezes the interview evidence.
- Draft generation produces a reviewable immutable revision with three to five provenance-linked
  insights.
- The review distinguishes evidence, derived insight, and final persona instructions.

APIs: `POST .../complete`, then `POST .../draft` with empty request bodies.

## PER-05 — Approve the exact persona revision

**As an** Owner, **I want** to approve the exact draft I reviewed **so that** future runs use a
deliberate, auditable persona.

Acceptance criteria:

- Approval names the immutable revision being activated.
- Stale, foreign, incomplete, changed-template, and persistence conflicts fail closed.
- Success explains that active runs are unchanged and future admitted runs use the new revision.

API: `POST /api/v1/me/persona/drafts/{personaRevisionId}/approve`.

## PER-06 — Refresh persona after an accepted proposal

**As an** Owner, **I want** an accepted persona-refresh proposal to start a proposal-bound interview
**so that** evolution remains governed by new evidence.

Acceptance criteria:

- The refresh displays the originating configuration proposal.
- The interview is bound to that proposal and can be resumed.
- A refresh cannot directly overwrite the active persona or an in-flight run snapshot.

API: `POST /api/v1/me/persona/refreshes/{configurationChangeId}/interview`.

## Design component candidates

Compose a progress header, one question renderer per typed question kind, save/continue controls,
an evidence-to-insight review list, revision summary, and confirmation dialog. Extend shared settings
primitives only when their semantics match; do not make the route component own every question's
visual and validation contract.
