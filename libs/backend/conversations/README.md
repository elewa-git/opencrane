# Conversations — reusable conversation processing

> [backend](../README.md) › conversations

This group contains backend behaviour that applies to every conversation transport and mode. It is
kept outside `server/` when it does not own HTTP routes, authentication or database access.

## Packages

| Package | Responsibility | Scope |
|---------|----------------|-------|
| [`projection`](./projection/main/README.md) | Turns an authorised canonical timeline into one safe, resumable browser event stream. | `conversation-projection` |

```text
 canonical conversation timeline
               │ authorised rows
               ▼
 ┌───────────────────────────┐
 │ projection                │  redact · map · cursor · stream
 └───────────────────────────┘
               │ safe Server-Sent Events
               ▼
      browser conversation state
```

## Dependency rule

Packages in this group may depend on shared contracts, conversation models and other explicitly
allowed conversation packages. They never depend on an app, frontend code, Express or Prisma.

## See also

- Parent index: [backend](../README.md)
- Server authority: [server conversations](../server/conversations/main/README.md)
- Browser consumer: [conversation AG-UI state](../../frontend/state/conversation/ag-ui/README.md)
