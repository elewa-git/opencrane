# OpenCrane UI design target

[`opencrane-frontend-wireframes.html`](./opencrane-frontend-wireframes.html) is the canonical visual
target for the current frontend implementation. The repository copy was imported from
`opencrane-frontend-wireframes-4.html` and has SHA-256
`b695783c1e3e7c07ba5712c86af03bc39855078d089bc9c7c4f32d4c0dc51f3c`.

The wireframe is product and component context, not evidence that a route, authority, or journey is
implemented. Code, Storybook states, Playwright journeys, deployment, and live qualification remain
separate exit gates in [`plan.md`](../../plan.md).

## Conversation workspace scope

- Boards `8a` through `8i` define the workspace shell, onboarding history, streaming and reconnect,
  attachments, durable assets, tool activity, elicitation, A2UI, Files, and Activity.
- Boards `9a` through `9f` define the reviewed A2UI component catalogue and its recovery,
  accessibility, compact-layout, and safe-disclosure states.
- Boards `10a` through `10g` define group `@agent` admission, the complete parent-summary state
  machine, the breadcrumb Agent-thread workspace, immediate-parent delivery, serial follow-up runs,
  compact navigation, routes, access loss, and authority boundaries.

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
