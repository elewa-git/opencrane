# OpenCrane product user stories

These files are the editable handoff between product, design, frontend, and backend work. Stories are
grouped by product feature so one feature can be designed, contracted, implemented, and qualified
without reopening the whole frontend programme.

## Status vocabulary

| Status | Meaning |
|---|---|
| `API ready` | A public API and its core authority checks exist. This does not by itself prove a live end-to-end deployment. |
| `API partial` | Part of the journey exists, but a required transition, dependency, or truthful readiness signal is missing. |
| `API blocked` | The user outcome cannot be implemented through the public API yet. |
| `UI early` | A routed UI exists, but it is incomplete or presents placeholder behaviour. |
| `UI missing` | There is no routed product journey for the story. |
| `Design ready` | Product behaviour is finite enough to design canonical screens and states. |
| `Needs decision` | Product or authority semantics must be decided before design is treated as final. |

Statuses describe the current repository, not the importance or final product priority. A story may
be `Design ready` while its API is blocked; that means design can define the target and its states,
not that frontend implementation can invent the missing behaviour.

## Story contract

Every story records:

- the actor, desired outcome, and user value;
- acceptance criteria expressed as observable product behaviour;
- the finite states the designer must cover;
- the public API dependency and current delivery status;
- authority and non-disclosure boundaries that the frontend must preserve.

During implementation, add the final route, component map, API contract, tests, and qualification
evidence to the owning file. Do not silently change a blocked story into frontend-only success.

## Feature index

| Feature | File | Current headline |
|---|---|---|
| Identity and onboarding | [identity-and-onboarding.md](identity-and-onboarding.md) | OIDC and first-owner admission work; workspace onboarding does not. |
| Persona | [persona.md](persona.md) | Governed interview lifecycle exists; UI and mutation contract generation are missing. |
| Workspace and conversations | [workspace-and-conversations.md](workspace-and-conversations.md) | Replay exists; thread and prompt creation do not. |
| Runs and approvals | [runs-and-approvals.md](runs-and-approvals.md) | Admission, status and steering exist; cancellation and production approval resume are incomplete. |
| Personal configuration | [personal-configuration.md](personal-configuration.md) | Proposal consent and future-run materialization exist without a UI. |
| Managed agents | [managed-agents.md](managed-agents.md) | Revision, lifecycle, run-now, history and schedule APIs exist. |
| Tools and integrations | [tools-and-integrations.md](tools-and-integrations.md) | Catalogue metadata exists; credential/OAuth connection is not a real handshake. |
| Assets | [assets.md](assets.md) | Safe metadata catalogue only. |
| Skills | [skills.md](skills.md) | Safe catalogue only; no public authoring lifecycle. |
| Memory | [memory.md](memory.md) | No public management API; production reads remain an internal admission concern. |
| Organisation and sharing | [organization-and-sharing.md](organization-and-sharing.md) | Groups and sharing exist; member management and effective-access explanation do not. |
| Providers, models and routing | [providers-models-and-routing.md](providers-models-and-routing.md) | Configuration exists, with partial readiness and no runtime auto-routing consumer. |
| Budgets and usage | [budgets-and-usage.md](budgets-and-usage.md) | APIs exist but contract and authorization must be fixed before UI exposure. |
| Sources and discovery | [sources-and-discovery.md](sources-and-discovery.md) | CRUD exists; contract and authorization are stale. |
| Audit, health and readiness | [audit-health-and-readiness.md](audit-health-and-readiness.md) | Audit and basic health exist; product capability readiness does not. |

## Shared design requirements

Every interactive feature must define loading, empty, ready, validation-error, forbidden,
dependency-unavailable, conflict, and retry states where applicable. Long and localized content,
keyboard navigation, visible focus, reduced motion, responsive layout, and destructive-action
confirmation are part of the acceptance contract.

Use PrimeNG primitives first. Reuse or extend the approved OpenCrane elements (`SectionHeading`,
`SettingsRow`, `SaveButton`, `ScopeChip`, `AvatarCircle`, `CollapsibleSection`, and `LedgerCard`)
before proposing a second base primitive. Feature-specific components own domain vocabulary; shared
elements remain presentational and never fetch data.

## Component implementation gate

These stories are product and design seeds, not proof that the current component catalogue already
implements their states. Before implementing any feature:

1. Run the component-manager `PLAN` pass for the selected stories.
2. Map every visible region to `REUSE`, `EXTEND`, `COMPOSE`, `EXTRACT`, `NEW`, or `KEEP INLINE`.
3. Define finite typed visual states, keyboard/focus behaviour, live announcements, narrow/wide
   fixtures, long/localized content, reduced motion, and dependency failure.
4. Add the missing component behaviour, accessibility, and state-rendering evidence before composing
   the route-level screen.
5. Run the component-manager `POST-DIFF` pass after implementation.

The current repository has no shared Storybook/state renderer, screenshot baselines, axe setup, or
CDK component harnesses. Existing context and notification components are unmounted/demo-state
surfaces, not approved target behaviour. Shared chips, collapsible sections, ledger cards, settings
rows, save buttons, and avatars also require typed-state or accessibility work before broader reuse.
