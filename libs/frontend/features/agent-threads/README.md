# @opencrane/features/agent-threads — group Agent-thread workspace

> [frontend](../../README.md) › [features](../README.md) › agent-threads

## What it owns

This package owns the UI for invoking an Agent from a group message, showing the compact child
summary below that message, and presenting the linked child conversation as a full workspace. The
application route added by #351 supplies immutable route ids and owns navigation, focus, and scroll
restoration; this feature renders the route-ready page and returns exact typed intents.

```
 parent group message ── @agent intent ──► backend admission
          │                                      │ child snapshot
          ▼                                      ▼
 compact summary                         agent-threads  ◄── HERE
                                                 │ exact parent restore intent
                                                 ▼
                                         app route coordinator
```

**In this flow:** [`state/conversation/agent-threads`](../../state/conversation/agent-threads/README.md) · the application route coordinator

Run lifecycle, conversation access, live-delivery recovery, and mention admission remain separate
dimensions. The page uses an explicit route-state switch. It reuses the shared conversation,
asset, elicitation, Activity, and A2UI renderers rather than copying their contracts.

## Public surface

- `AgentThreadMentionControlComponent` emits one root-message coordinate for admission.
- `AgentThreadSummaryComponent` renders every compact parent state and emits an exact open intent.
- `AgentThreadPageComponent` is the thin route-ready child workspace.
- Origin, run-boundary, delivery, queued, available, access-changed, and unavailable components keep
  those states independently testable.
- Mapper functions translate dependency-neutral store models into shared conversation elements.

## Boundary

This feature neither calls HTTP nor starts a run. It cannot grant access, infer a missing route's
existence, select personal memory, or deliver beyond the immediate parent. The generated-client
adapter and production route composition arrive only after their backend contracts exist.

## Dependency direction

The package carries `scope:agent-threads` and `frontend-role:feature-shell`. It may compose approved
elements, Agent-thread state, and the existing asset, elicitation, Activity, and A2UI presentation
packages. It must not import a backend package, app, or concrete adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/agent-threads`](../../state/conversation/agent-threads/README.md)
- Reused presentations: [`conversation-assets`](../conversation-assets/README.md) · [`conversation-elicitation`](../conversation-elicitation/README.md) · [`conversation-activity`](../conversation-activity/README.md)
