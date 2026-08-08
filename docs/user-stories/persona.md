# Persona user stories

## Feature intent

Let a person deliberately define and evolve how their personal agent collaborates. The onboarding
interview is a preference-setting sorting quiz that maps users to one of four colour-coded agent
archetypes (Red Commander, Yellow Catalyst, Green Anchor, Blue Analyst) plus an Openness modifier
(Explorer/Guardian). Persona changes are reviewed, provenance-linked, immutable revisions rather
than hidden prompt mutation.

Current status: `API partial` for the existing finite interview/draft/approval lifecycle and `UI
missing`. The internal lifecycle exists, but only the status read appears in the generated OpenAPI
contract today. Weighted scoring, tie resolution, bootstrap selection, and safe durable
preference-memory admission and writes remain `API blocked`.

## Onboarding relationship

The initial governed persona interview fulfils the survey phase of the server-tracked onboarding
workflow in [identity-and-onboarding.md](identity-and-onboarding.md). Persona remains the authority
for questions, answers, evidence, drafts, and approval. `UserOnboarding` records only the exact
interview/revision reference and advances routing after the server verifies an approved persona; it
does not duplicate persona content or let the browser declare survey completion.

> See also: [persona sorting quiz](../design/persona-sorting-quiz.md),
> [persona archetype templates](../design/persona-archetypes/README.md),
> [persona memory boundary](../design/persona-memory-boundary.md),
> [AI persona onboarding research](../research/ai-persona-onboarding-research.md)

## PER-01 — See persona readiness

**As an** Owner, **I want** to see whether my persona needs an interview, review, or no action **so
that** I can continue from the correct point.

Acceptance criteria:

- The UI distinguishes `interview`, `review`, and `ready`.
- Progress includes answered and total question counts without exposing another owner's records.
- Reloading resumes the active interview or review.
- When a persona is active, the UI shows the assigned colour archetype, Openness modifier, and
  secondary colour blend.

API: `GET /api/v1/me/persona`.

## PER-02 — Start or resume the sorting quiz

**As an** Owner, **I want** to start or resume the preference-setting sorting quiz **so that** my
collaboration preferences are captured against a stable, reviewed question set.

Acceptance criteria:

- Starting twice reuses the one active interview instead of duplicating it.
- The quiz covers ten questions across five axes: pace (decision speed, response preference),
  focus (feedback preference, interaction energy), openness (approach to novelty, risk appetite),
  proposal initiative (suggestion cadence, challenge preference), and working relationship
  (relationship model, tone preference).
- The quiz is framed as a preference-setting exercise ("how would you like your assistant to work
  with you?"), never as a personality diagnosis.
- Each reviewed choice adds its declared weights to one or more colour counters, the Openness axis,
  or both. No answer is "wrong," and an omitted weight is exactly zero.
- The question-set version binds the reviewed choice catalogue and scoring-policy version/digest;
  an in-progress interview cannot silently move to different prompts, choices, or weights.
- Question order, required state, progress, long text, and validation are explicit.
- A missing reviewed question set is shown as configuration unavailable, not an empty interview.

API: `POST /api/v1/me/persona/interview`.

## PER-03 — Answer each quiz question once

**As an** interview participant, **I want** each answer saved against the exact reviewed question
**so that** my evidence cannot silently move between versions.

Acceptance criteria:

- An answer is appended once and acknowledged before the next question is treated as complete.
- Empty, invalid, oversized, duplicate, conflict, and persistence-failure states are designed.
- The user can revisit already recorded answers as read-only evidence.

API: `POST /api/v1/me/persona/interviews/{interviewId}/answers/{questionId}`.

## PER-04 — Complete and review the sorting result

**As an** Owner, **I want** to complete the quiz and inspect the generated persona draft **so that**
I can verify what OpenCrane inferred before activation.

Acceptance criteria:

- Completion is unavailable until every required question is answered.
- Completion freezes the interview evidence and computes the full colour and Openness score vector
  under the exact reviewed scoring-policy version/digest.
- The result presentation shows:
  - Primary colour archetype with name (e.g., "The Analyst" in blue).
  - Secondary colour influence (e.g., "with Commander tendencies").
  - Openness modifier (Explorer or Guardian).
  - Continuous colour-score percentages.
  - Three to five provenance-linked insights tracing specific answers to specific collaboration
    preferences.
- A tied primary/secondary rank or tied Openness score is displayed without a preferred default.
  The Owner chooses between the tied results; the exact tie candidates and explicit choice are
  persisted as interview evidence before draft generation becomes available.
- Draft generation produces a reviewable immutable revision by selecting from the reviewed SOUL
  template library using the deterministic score vector plus any explicit tie-resolution evidence.
- The revision preserves the scoring-policy identity, full score vector, selected template
  identity/digest, interpolation inputs, and exact answer/tie-choice provenance.
- The review distinguishes evidence (quiz answers), derived insight (preference mapping), and final
  persona instructions (SOUL template content).

APIs: `POST .../complete`, then `POST .../draft` with empty request bodies.

## PER-05 — Approve the exact persona revision

**As an** Owner, **I want** to approve the exact draft I reviewed **so that** future runs use a
deliberate, auditable persona.

Acceptance criteria:

- Approval names the immutable revision being activated.
- Stale, foreign, incomplete, changed-template, and persistence conflicts fail closed.
- Success explains that active runs are unchanged and future admitted runs use the new revision.
- Approval activates the exact already-compiled instructions that the Owner reviewed; it does not
  recompile mutable source. Future admitted runs may use that revision, while active run snapshots
  remain unchanged.
- Bootstrap identity, one-time-use evidence, and admission are not part of the current revision or
  approval contract; they remain the blocked future contract in PER-07.

API: `POST /api/v1/me/persona/drafts/{personaRevisionId}/approve`.

## PER-06 — Refresh persona after an accepted proposal

**As an** Owner, **I want** an accepted persona-refresh proposal to start a proposal-bound interview
**so that** evolution remains governed by new evidence.

Acceptance criteria:

- The refresh displays the originating configuration proposal.
- The interview is bound to that proposal and can be resumed.
- A refresh cannot directly overwrite the active persona or an in-flight run snapshot.
- Re-sorting through a refresh may produce a different colour archetype; this is shown clearly
  in the draft review with a comparison to the current archetype.

API: `POST /api/v1/me/persona/refreshes/{configurationChangeId}/interview`.

## PER-07 — Experience archetype-appropriate first session

**As a** newly approved Owner, **I want** my personal agent's first conversation to follow a
bootstrap script tailored to my colour archetype **so that** the onboarding experience feels
natural and aligned with my communication preferences.

Acceptance criteria:

- The first conversation after persona approval uses the archetype-specific bootstrap script
  (Commander, Catalyst, Anchor, or Analyst).
- The bootstrap includes a brief self-introduction in the archetype's voice and three calibration
  questions whose answers remain ordinary conversation evidence by default.
- The bootstrap is used once and does not recur in subsequent sessions.
- A calibration answer may produce a candidate preference for the Owner to review, but it is never
  retained automatically. Durable retention requires explicit confirmation and the governed memory
  gateway/catalog lifecycle; that production write path is currently unavailable and fails closed.
- The bootstrap adapts its pacing and tone to the archetype (e.g., Commander is fast and direct,
  Anchor is patient and checks in).

Status: `API blocked`; no reviewed bootstrap selection, one-time-use evidence, or durable-memory
write flow is production-composed.

## PER-08 — See how persona adapts over time

**As an** Owner, **I want** to understand how my agent's behaviour evolves through memory-based
adaptation **so that** I retain transparency and control over personality changes.

Acceptance criteria:

- Only explicitly supplied or subsequently confirmed candidate preferences may become durable;
  conversational inference alone never authorises retention.
- A retained preference is distinct from the approved persona and exposes its source, provenance,
  consent, sensitivity, and the future-run snapshots in which it may be admitted.
- Record, correction, and forget operations use the authenticated memory gateway and catalog
  lifecycle. Missing gateway evidence, consent, or ownership fails closed.
- Demographic attributes, including gender, are never inferred or retained as persona preferences.
- The SOUL template itself does not change without a full persona refresh cycle.
- The UI explains the distinction: "Your core personality is your approved archetype. Your agent
  can retain a preference only after you confirm it."

Status: `API blocked`; safe catalog-matched injection plus list, record, correction, and forget APIs
are not available today.

## Design component candidates

Compose a colour-themed progress header showing the 2×2 grid filling in as answers are given, one
question renderer per typed question kind (single choice with weighted scoring), save/continue
controls, a colour-result presentation with primary/secondary/modifier breakdown and provenance-
linked insights, a neutral tie-choice state, revision summary with SOUL template preview, and
confirmation dialog. Add candidate-preference review and memory-management views only when the
governed APIs exist. Extend shared settings primitives only when their semantics match; do not make
the route component own every question's visual and validation contract.
