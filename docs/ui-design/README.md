# OpenCrane UI design target

[`opencrane-frontend-wireframes.html`](./opencrane-frontend-wireframes.html) is the canonical visual
context target for the current frontend plan. The repository copy was imported from
`opencrane-frontend-wireframes-4.html` and has SHA-256
`b695783c1e3e7c07ba5712c86af03bc39855078d089bc9c7c4f32d4c0dc51f3c`.

The wireframe is product and component context, not evidence that a route, authority, or journey is
implemented or fully specified. Code, Storybook states, Playwright journeys, deployment, and live
qualification remain separate exit gates in [`plan.md`](../../plan.md).

## Conversation workspace scope

- Boards `8a` through `8j` define the workspace shell, onboarding history, streaming and reconnect,
  attachments, durable assets, tool activity, elicitation, A2UI, Files, and Activity.
- Boards `9a` and `9b` define the proposed A2UI component catalogue and progressive render.
- Boards `10a` through `10g` define group `@agent` admission, the complete parent-summary state
  machine, the breadcrumb Agent-thread workspace, immediate-parent delivery, serial follow-up runs,
  compact navigation, routes, and authority boundaries. Some access and recovery cases are stated
  as text rather than shown as dedicated boards.

## Open design gates

The current export is the context target, but F1 implementation is blocked until these mismatches
are resolved in a follow-up design handoff:

- Add dedicated Agent-thread boards for a busy Agent mention that queues, a fully unauthorized or
  access-revoked child route, a deep link that opens directly at a waiting ask card, and reconnect
  while the child run is active. Boards `10a` and `10g` currently describe these rules without
  showing the complete states.
- Reconcile the A2UI catalogue count: board `9a` says ten components but presents eleven.
- Freeze the protocol vocabulary and the [#319](https://github.com/elewa-git/opencrane/issues/319)
  retain/re-pin-versus-delete decision. Board `9b` says `updateComponents` and `updateDataModel`,
  while the existing sink uses `surfaceUpdate` and `dataModelUpdate`.
- Add asset states for scanning, inaccessible, expired, removed or foreign, and define exactly when
  removal remains authorized instead of treating every lifecycle point as locally removable.
- Make bounded free text visibly bounded, distinguish a selected choice from a submitted answer,
  and specify step-up authentication focus and recovery behavior.
- Treat the Agent-thread summary as a projection of orthogonal run, conversation, access, recovery,
  and admission state rather than one domain enum. Route with an immutable server-issued identity;
  display slugs alone are not stable coordinates.
- Reconcile the wireframe focus note with the production tokenized 3px focus ring. New components
  extend the production theme instead of copying hard-coded colors or a second focus rule.
- After those decisions, refresh the affected screenshots and require component-manager `PASS`
  before mounting the routed workspace.

## Issue evidence map

The images under [`screenshots/`](./screenshots/) are stable, reviewable extracts from the canonical
target. Use only the screenshots relevant to the owning issue.

| Issue | Design evidence |
|---|---|
| [#600](https://github.com/elewa-git/opencrane/issues/600) | `conversation-rail.png`, `agent-thread-mention.png`, `agent-thread-workspace.png`, `agent-thread-contract.png` |
| [#601](https://github.com/elewa-git/opencrane/issues/601) | `agent-thread-mention.png`, `agent-thread-summary-states.png`, `agent-thread-workspace.png`, `agent-thread-parent-delivery.png`, `agent-thread-follow-up.png`, `agent-thread-mobile.png`, `agent-thread-contract.png` |
| [#602](https://github.com/elewa-git/opencrane/issues/602) | `onboarding-read-only.png` |
| [#603](https://github.com/elewa-git/opencrane/issues/603) | `conversation-attachments.png`, `conversation-assets.png`, `conversation-files-activity.png` |
| [#604](https://github.com/elewa-git/opencrane/issues/604) | `conversation-tool-calls.png`, `conversation-elicitation.png`, `conversation-a2ui.png`, `a2ui-component-catalog.png`, `conversation-files-activity.png` |
| [#319](https://github.com/elewa-git/opencrane/issues/319) | `conversation-streaming-reconnect.png`, `conversation-elicitation.png`, `conversation-a2ui.png`, `a2ui-component-catalog.png` |
| [#351](https://github.com/elewa-git/opencrane/issues/351) | The complete workspace and Agent-thread set |

## Change control

Replace the canonical HTML only with an explicitly accepted design export. Record its source label
and checksum here, refresh changed screenshot extracts, update the issue evidence map, and reconcile
the finite states and execution order in `plan.md` in the same commit series.
