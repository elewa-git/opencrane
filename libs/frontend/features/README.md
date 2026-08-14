# Features — routed UI slices

> [frontend](../README.md) › features

A **feature** is one slice of the app's screen: a routed page or a pane, plus the components that
fill it. Most are **lazy-loaded** — the browser only downloads a feature's code the first time its
route is opened, so the app starts small. Each feature exports the component the shell drops into
its slot; the shell itself is `workspace`.

## Map

| Package | What it owns |
| --- | --- |
| [`context`](./context/README.md) | The right-hand context pane. |
| [`agent-threads`](./agent-threads/README.md) | Group `@agent` admission, compact summaries, and the full child workspace. |
| [`conversation-assets`](./conversation-assets/README.md) | Attachment chips, transcript file cards, and grouped Files presentation. |
| [`conversation`](./conversation/README.md) | The centre conversation pane. |
| [`conversation-activity`](./conversation-activity/README.md) | Derived request and tool-failure index with canonical deep links. |
| [`conversation-elicitation`](./conversation-elicitation/README.md) | Recoverable question and approval card. |
| [`conversation-workspace`](./conversation-workspace/README.md) | Normal direct, group, and Agent-session chat workspace. |
| [`notifications`](./notifications/README.md) | The notification popover. |
| [`onboarding`](./onboarding/README.md) | One resumable lifecycle shell with interview, resolution, review, and ready states. |
| [`settings`](./settings/README.md) | The settings page. |
| [`tools`](./tools/README.md) | Tools and tool-governance routes. |
| [`workspace`](./workspace/README.md) | The workspace shell. |

```
                       workspace (the shell)
         ┌──────────────┼───────────────┐
   conversation      context        notifications
   (centre pane)   (right pane)      (bell popover)
         │
   routed pages: onboarding · settings · tools
```

## Dependency rule for this tier

Legacy features carry `scope:web`; new capability slices use a bounded `scope:<capability>`. Every
feature is a `type:lib`. `features/onboarding` also carries `frontend-role:feature`, which admits
only shared [`elements`](../elements/README.md) and its [`state`](../state/README.md) port. A feature
may **not** import a sibling feature — the one exception is `workspace`, the shell, which composes
the others. Cross-feature sharing goes down into `elements` or `state`, never sideways. Never import
a backend package or an app.

## See also

- Parent index: [`libs/frontend`](../README.md)
- Sibling groups: [`libs/frontend/elements`](../elements/README.md) · [`libs/frontend/state`](../state/README.md)
