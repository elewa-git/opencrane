# @opencrane/features/agent-threads — group Agent-thread workspace

> [frontend](../../README.md) › [features](../README.md) › agent-threads

## What it owns

This package owns the UI for invoking an Agent from a group message, showing the compact child
summary below that message, and presenting the linked child conversation as a full workspace. The
application mounts the guarded URL and supplies the production gateway; this feature owns the route
coordinator, navigation, browser-history restoration, focus, and the complete child workspace. It
persists unread state only after Angular has rendered the represented snapshot, and then adopts the
server's confirmed count.

```
 parent group message ── @agent intent ──► backend admission
          │                                      │ child snapshot
          ▼                                      ▼
 compact summary                         agent-threads  ◄── HERE
                                                 │ exact parent restore coordinate
                                                 ▼
                                       feature route coordinator
```

**In this flow:** [`state/conversation/agent-threads`](../../state/conversation/agent-threads/README.md) · the application route mount

Run lifecycle, conversation access, live-delivery recovery, and mention admission remain separate
dimensions. The page uses an explicit route-state switch. It reuses the shared conversation,
asset, elicitation, Activity, and A2UI renderers rather than copying their contracts.

## Public surface

- `AgentThreadMentionControlComponent` selects a display-safe Agent target before the ordinary group
  composer submits the message and target atomically.
- `AgentThreadSummaryComponent` renders run/update/result/asset metadata and emits a canonical target
  together with exact parent restoration coordinates.
- `AgentThreadPageComponent` is the thin route-ready child workspace. Its breadcrumbs emit route
  intents, its post-render hook focuses the canonical target and marks only rendered positions read,
  and its purge intent tells the feature route coordinator to discard Activity, elicitation, asset,
  A2UI, draft, and cursor projections together.
- `AgentThreadRouteComponent` binds immutable route ids to that workspace, restores the exact parent
  browser-history coordinate, owns external child projections, and purges them as one projection.
- Origin, run-boundary, delivery, queued, available, access-changed, and unavailable components keep
  those states independently testable.
- Mapper functions translate dependency-neutral store models into shared conversation elements.

## Boundary

This feature neither calls HTTP nor starts a run. It cannot grant access, infer a missing route's
existence, select personal memory, or deliver beyond the immediate parent. The generated-client
adapter lives in state; the production app only mounts the guarded route and binds that adapter.

## Dependency direction

The package carries `scope:agent-threads` and `frontend-role:feature-shell`. It may compose approved
elements, Agent-thread state, and the existing asset, elicitation, Activity, and A2UI presentation
packages. It must not import a backend package, app, or concrete adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/agent-threads`](../../state/conversation/agent-threads/README.md)
- Reused presentations: [`conversation-assets`](../conversation-assets/README.md) · [`conversation-elicitation`](../conversation-elicitation/README.md) · [`conversation-activity`](../conversation-activity/README.md)
