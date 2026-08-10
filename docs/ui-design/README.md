# OpenCrane UI design target

[`opencrane-frontend-wireframes.html`](./opencrane-frontend-wireframes.html) is the canonical visual
context target for the current frontend plan. The repository copy was imported from
`opencrane-frontend-wireframes-4.html` and has SHA-256
`b695783c1e3e7c07ba5712c86af03bc39855078d089bc9c7c4f32d4c0dc51f3c`.

[`opencrane-conversation-state-supplement.html`](./opencrane-conversation-state-supplement.html)
is the finite-state supplement to that accepted v4 export. It preserves v4's workspace and
paper/origami language while resolving the edge cases that v4 deliberately left in its “Try next”
notes. The supplement takes precedence only for the finite-state and protocol corrections enumerated
below; v4 remains authoritative for workspace composition and visual language.

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

## Resolved finite-state contract

Supplement boards `11a` through `11f` close the v4 design gaps without changing its primary
workspace composition:

- `11a` renders queued Agent-thread admission, active reconnect, direct ask-card deep links, and the
  fully revoked child route. Revocation purges rendered child content, drafts, cursors, filenames,
  run details, and ask text; only a non-disclosing restricted parent summary remains.
- `11b` renders scanning, inaccessible, expired, removed, and foreign asset states. Local selections
  are removable before admission; after admission the server must return a removal capability.
- `11c` makes free text visibly bounded, separates local selection from authoritative submission,
  and restores focus to the original ask after step-up authentication.
- `11d` retains the in-process A2UI sink but re-pins it directly to supported upstream A2UI packages,
  removing OpenClaw lockstep. The catalogue contains eleven admitted components, uses upstream
  `surfaceUpdate` and `dataModelUpdate` vocabulary, and returns actions only through server authority.
- `11e` projects parent summaries from orthogonal run, conversation, access, recovery, and admission
  dimensions. Canonical routes use immutable conversation ids; display slugs remain labels only.
- `11f` provides compact equivalents. All states use the production tokenized 3px focus ring and
  retain keyboard, announcement, and reduced-motion semantics.

The component-manager gate passed against the live catalogue on 2026-08-10. The accepted v4
screenshots remain the primary issue evidence;
`conversation-state-supplement.png` is the stable edge-state extract until production Storybook owns
deterministic component screenshots.

## Issue evidence map

The images under [`screenshots/`](./screenshots/) are stable, reviewable extracts from the canonical
target. Use only the screenshots relevant to the owning issue.

| Issue | Design evidence |
|---|---|
| [#600](https://github.com/elewa-git/opencrane/issues/600) | `conversation-rail.png`, `agent-thread-mention.png`, `agent-thread-workspace.png`, `agent-thread-contract.png`, `conversation-state-supplement.png` board `11e` |
| [#601](https://github.com/elewa-git/opencrane/issues/601) | `agent-thread-mention.png`, `agent-thread-summary-states.png`, `agent-thread-workspace.png`, `agent-thread-parent-delivery.png`, `agent-thread-follow-up.png`, `agent-thread-mobile.png`, `agent-thread-contract.png`, `conversation-state-supplement.png` boards `11a`, `11e`, `11f` |
| [#602](https://github.com/elewa-git/opencrane/issues/602) | `onboarding-read-only.png` |
| [#603](https://github.com/elewa-git/opencrane/issues/603) | `conversation-attachments.png`, `conversation-assets.png`, `conversation-files-activity.png`, `conversation-state-supplement.png` board `11b` |
| [#604](https://github.com/elewa-git/opencrane/issues/604) | `conversation-tool-calls.png`, `conversation-elicitation.png`, `conversation-a2ui.png`, `a2ui-component-catalog.png`, `conversation-files-activity.png`, `conversation-state-supplement.png` boards `11c`, `11d` |
| [#319](https://github.com/elewa-git/opencrane/issues/319) | `conversation-streaming-reconnect.png`, `conversation-elicitation.png`, `conversation-a2ui.png`, `a2ui-component-catalog.png`, `conversation-state-supplement.png` boards `11a`, `11d` |
| [#318](https://github.com/elewa-git/opencrane/issues/318) | `conversation-elicitation.png`, `conversation-a2ui.png`, `conversation-files-activity.png` |
| [#243](https://github.com/elewa-git/opencrane/issues/243) | `conversation-elicitation.png`, `conversation-files-activity.png` |
| [#351](https://github.com/elewa-git/opencrane/issues/351) | The complete workspace and Agent-thread set |

## Change control

Replace the canonical HTML only with an explicitly accepted design export. Record its source label
and checksum here, refresh changed screenshot extracts, update the issue evidence map, and reconcile
the finite states and execution order in `plan.md` in the same commit series.
