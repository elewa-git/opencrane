# @opencrane/backend/server/agents/onboarding — durable first-route authority

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › onboarding

## What it owns

This package owns the server-tracked workflow that routes one authenticated person through persona
survey and bootstrap chat before the main product. Authentication supplies the silo and stable OIDC
subject; the persona package supplies interview, approval, display-name, and primary-colour
evidence; onboarding owns the exact immutable bootstrap source and exchange.

The package owns the survey hand-off and first guided exchange end to end:

1. Create one workflow pinned to the current workflow version in `survey_pending`.
2. Verify and pin an owner-bound persona interview before entering `survey_in_progress`.
3. Resume the same interview, or CAS-replace its exact pin when the owner deliberately sorts again
   before leaving `survey_in_progress`.
4. Verify the exact approved persona revision before entering `bootstrap_chat_pending`.
5. Select and pin one reviewed Commander, Catalyst, Anchor, or Analyst script revision.
6. Append exactly three bounded answers in order; each request echoes the server-issued conversation
   and question coordinate, identical retries resume, and stale devices or conflicting key reuse fail.
7. Conclude server-side only after all three answers and atomically complete onboarding.

```text
 authenticated session       persona evidence authority
   silo + OIDC subject          interview + approval
             \                    /
              ▼                  ▼
       ┌────────────────────────────┐
       │ user onboarding  ◄── HERE  │  durable route state + exact references
       └────────────────────────────┘
                       │ persona + script pinned
                       ▼
             deterministic 3-answer chat
```

**In this flow:** [persona evidence](../../../../agents/personal/personas/main/README.md)

The invariant is that a browser never chooses its own silo, subject, survey completion, approved
persona, script, conversation, question, or completion. A failed or conflicting transition leaves
the last durable state unchanged. This guided exchange is not a general chat or agent-runtime path.
This package
accepts repeated owner-bound interview notifications. Before observing a newer interview, its
coordinator first reconciles an already-approved persona for the durable pinned interview, closing
the post-commit notification gap. Initial-survey replacement remains open only until the pinned
interview's persona becomes active; PostgreSQL closes the opposite side of that approval race with a
single onboarding-first lock order and requires approval to match the current pin.

## Public surface

- `__UserOnboardingAuthority` reads/creates route state and admits interview-start and approved-persona transitions.
- `__UserOnboardingChatAuthority` selects reviewed content, renders the deterministic transcript,
  appends answers only against exact projected coordinates, and admits server conclusion.
- `_CreateUserOnboardingRepository` composes the Prisma persistence adapter at the server edge.
- `__CreateUserOnboardingRouter` exposes route state plus the four owner-only chat endpoints, while
  `UserOnboardingPersonaWorkflowCoordinator` translates accepted persona events into workflow transitions.
- `UserOnboardingRouterDependencies`, `UserOnboardingOwnerResolver`, and
  `UserOnboardingPersonaWorkflowPort` are the narrow logged HTTP and persona-notification
  composition contracts.
- `_UserOnboardingOpenapiPaths` contributes route-state and guided-chat contracts to the generated API.
- The workflow, archetype, colour, completion, denial, and transition enums form the exported
  composition vocabulary; chat wire details stay internal to the authority and HTTP boundary.
- Owner, approved-persona evidence, and transition types define the exported authority contracts;
  immutable script, transcript, answer, projection, and repository shapes remain package-internal.

## Boundary

Callers must derive `UserOnboardingOwner` from the verified request principal. Persona survey
questions, scores, drafts, compiled instructions, and approval remain owned by the persona package.
Bootstrap answers remain ordinary evidence: they grant no memory retention or action authority.

## Dependency direction

The project uses `scope:user-onboarding`. It may depend on its own scope and `scope:shared`; the app
may compose it, but this package never imports app code or frontend state.

## Data & persistence

This package owns `UserOnboarding`, immutable bootstrap content and questions, the single
conversation, append-only answers, and their enums in
`apps/opencrane/prisma/schema/user-onboarding.prisma`. PostgreSQL is authoritative; browser storage
is not. The immutable conversation carries provenance only; `UserOnboarding.state` and
`UserOnboarding.completedAt` are the sole completion authority, admitted only when its pinned
conversation has exactly three answers. The reviewed clean-database baseline contains the same
schema plus lifecycle triggers and is the deployment setup boundary. Initial workflow provisioning
supplies its opaque identifier explicitly on the native upsert path instead of relying on an
ORM-side default for a database column with no SQL default.

## See also

- [Server agent capabilities](../../README.md)
- [Persona authority](../../../../agents/personal/personas/main/README.md)
- [Conversation replay](../../conversation-replay/main/README.md)
