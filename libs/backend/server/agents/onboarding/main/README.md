# @opencrane/backend/server/agents/onboarding — durable first-route authority

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › onboarding

## What it owns

This package owns the server-tracked workflow that routes one authenticated person through persona
survey and bootstrap chat before the main product. Authentication supplies the silo and stable OIDC
subject; the persona package supplies interview and approval evidence; later bootstrap orchestration
will supply the exact conversation and immutable `bootstrap.md` content revision.

The current slice owns the survey stages end to end:

1. Create one workflow pinned to the current workflow version in `survey_pending`.
2. Verify and pin an owner-bound persona interview before entering `survey_in_progress`.
3. Resume the same interview, or CAS-replace its exact pin when the owner deliberately sorts again
   before leaving `survey_in_progress`.
4. Verify the exact approved persona revision before entering `bootstrap_chat_pending`; later
   owner-verified persona maintenance is accepted without regressing the completed survey workflow.

```text
 authenticated session       persona evidence authority
   silo + OIDC subject          interview + approval
             \                    /
              ▼                  ▼
       ┌────────────────────────────┐
       │ user onboarding  ◄── HERE  │  durable route state + exact references
       └────────────────────────────┘
                       │ approved persona pinned
                       ▼
              bootstrap provisioning
```

**In this flow:** [persona evidence](../../../../agents/personal/personas/main/README.md) · bootstrap
provisioning (planned)

The invariant is that a browser never chooses its own silo, subject, survey completion, or approved
persona. A failed or conflicting transition leaves the last durable state unchanged. This package
does not yet enforce the global main-API fence because bootstrap provisioning and conclusion are not
available yet.

## Public surface

- `__UserOnboardingAuthority` reads/creates route state and admits interview-start and approved-persona transitions.
- `_CreateUserOnboardingRepository` composes the Prisma persistence adapter at the server edge.
- `__CreateUserOnboardingRouter` exposes the owner-only route-state projection, while
  `UserOnboardingPersonaWorkflowCoordinator` translates accepted persona events into workflow transitions.
- `UserOnboardingRouterDependencies`, `UserOnboardingOwnerResolver`, and
  `UserOnboardingPersonaWorkflowPort` are the narrow logged HTTP and persona-notification
  composition contracts.
- `_UserOnboardingOpenapiPaths` contributes the route-state contract to the generated API.
- `UserOnboardingStates`, completion provenance, transition statuses, and denial reasons are the stable workflow vocabulary.
- `UserOnboardingOwner`, persona evidence, record, and transition result types define the owner-bound authority contract.

## Boundary

Callers must derive `UserOnboardingOwner` from the verified request principal. Persona questions,
answers, scores, drafts, revisions, and approval remain owned by the persona package and enter only
through the evidence port. Bootstrap content and transcript content are never copied into this row.

## Dependency direction

The project uses `scope:user-onboarding`. It may depend on its own scope and `scope:shared`; the app
may compose it, but this package never imports app code or frontend state.

## Data & persistence

This package owns `UserOnboarding` and its state and completion-provenance enums in
`apps/opencrane/prisma/schema/user-onboarding.prisma`. PostgreSQL is authoritative; browser storage
is not. The reviewed clean-database baseline contains the same schema plus lifecycle triggers and is
the deployment setup boundary.

## See also

- [Server agent capabilities](../../README.md)
- [Persona authority](../../../../agents/personal/personas/main/README.md)
- [Conversation replay](../../conversation-replay/main/README.md)
