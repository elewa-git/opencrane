# @opencrane/backend/conversations/projection — one safe conversation event stream

> [backend](../../../README.md) › [conversations](../../README.md) › projection

## What it owns

This package turns an already-authorised conversation timeline into the browser's live event stream.
It is shared by all three immutable conversation modes. Direct and group conversations contribute
ordinary messages. An `agent_session` can additionally contribute run, tool, approval, elicitation,
child-agent and Agent-to-User Interface (AG-UI) events. The package never creates a run or changes a
conversation mode.

It owns the full projection process:

1. Ask a caller-supplied reader for an authorised page of canonical timeline rows.
2. Validate every row and copy only fields on the public allow-list. Credentials, proofs, provider
   bodies, tool arguments and arbitrary error details are discarded here.
3. Map the safe row to ordered AG-UI events. One ordinary message may become start, content and end
   events, each with its own resumable subframe cursor.
4. Encode complete, newline-injection-safe Server-Sent Event (SSE) records and respect transport
   backpressure before reading more.
5. Poll for durable rows, refresh cursorless approval or elicitation overlays, write heartbeats and
   stop at the configured duration fence. The client reconnects with its last cursor.

```text
 server conversations ........ checks participant access and reads canonical rows
             │ authorised page: message rows + optional run-event rows
             ▼
 ┌────────────────────────────────────────────────────────┐
 │ conversation projection  ◄── HERE                      │
 │ validate → redact → AG-UI map → cursor → SSE live tail │
 └────────────────────────────────────────────────────────┘
             │ display-safe, resumable events
             ▼
 frontend conversation adapter → AG-UI state → workspace
```

**In this flow:** [server conversations](../../../server/conversations/main/README.md) supplies the
authorised database reader and HTTP adapters · the [frontend event adapter](../../../../frontend/state/conversation/adapter/README.md)
reconnects the browser · [frontend AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
validates and reduces the records.

The invariant is strict: a durable cursor advances only after every safe subframe at that position
has been written. Invalid rows fail before the cursor advances. Lost authority produces one
non-disclosing purge event and closes the stream. An empty authorised page remains a normal live
stream, never an accidental access denial.

Tool failures remain visible even when a later attempt starts or succeeds. The stream may include a
server-selected technical classification such as `AuthenticationError`, because that helps a user
understand the problem. It never includes credentials, authorization headers, provider response
bodies, raw tool arguments, raw tool results or arbitrary exception text.

The stream also projects a versioned run-wait collection. Runtime-admitted outside actions,
participant input, server-proven approval, one-use personal-memory permission, and manual recovery
remain separate fixed categories. Cursorless participant snapshots replace only participant-owned
waits, so reconnect restores open questions and approvals without erasing outside work or recovery
evidence. The projection never copies a question, tool arguments, or provider text into this state.

### What each conversation mode can emit

| Mode | Canonical input | Projected output |
|------|-----------------|------------------|
| `direct` | participant messages | text message events |
| `group` | participant messages | text message events |
| `agent_session` | messages and run events | text, run, tool, failure, recovery, approval, elicitation, child-agent and governed A2UI events |

A group `@agent` mention starts a separate child `agent_session` conversation. That child uses this
same stream and can report its terminal result to its parent; the parent group does not silently
change mode or acquire run events of its own.

## Public surface

- `__StreamConversationProjection` — drains a snapshot, then runs the finite recovery-polled live
  tail with heartbeats, overlays, backpressure and revocation handling.
- `__EncodeConversationProjectionCursor` / `__DecodeConversationProjectionCursor` — encode and
  validate opaque `{ conversationId, position, subframe? }` resume coordinates.
- `CONVERSATION_PROJECTION_CLOCK` / `CONVERSATION_PROJECTION_LIMITS` — production time source and
  safe page, poll, heartbeat and response-duration bounds.
- `ConversationProjectionReader` / `ReadConversationProjectionCommand` /
  `ConversationProjectionReadResult` — framework-neutral port used by an authority-owning server
  adapter to return rows and current access from one snapshot.
- `ConversationProjectionReadStatuses` — explicit `authorized` versus `revoked_or_missing` result;
  the stream never treats lost access as an empty page.
- `ConversationProjectionDependencies`, `ConversationProjectionSink`, `ConversationOpenInterruptReader`, `ConversationProjectionClock`,
  `ConversationProjectionLimits`, `StreamConversationProjectionCommand` and
  `ConversationProjectionOutcomes` — small ports and result types used by transport composition.
- `ConversationProjectionEventRow` — canonical timeline row shape accepted from an authorised reader.

The row redactor, AG-UI mapper and SSE encoder stay package-private. They are policy steps inside one
pipeline, not general helpers that other packages should call out of order.

## Boundary

The package trusts neither row payloads nor cursors, but it does trust its reader to derive and check
the silo, participant and conversation together. It does not authenticate requests, query Prisma,
decide membership, write canonical events, choose conversation mode, create runs, serve Express
routes, retry browser connections or render interface components.

The [contracts package](../../../../contracts/README.md) owns stable AG-UI and A2UI wire shapes.
This package owns the server policy that turns internal rows into those shapes. The frontend imports
the contracts, never this backend package.

## Dependency direction

Tagged `scope:conversation-projection` and `layer:backend`: it may depend on shared models,
contracts, utilities, observability, its own scope, and the child-agent delivery vocabulary it
projects back to a parent conversation. It cannot import server authority packages, apps or
frontend code.

## Runtime & config

The production defaults read at most 200 rows per page, poll each second, send a heartbeat every 15
seconds and end a response after five minutes. Server composition may supply different values only
within the validation fences; invalid limits fail before the response opens.

The projected events conform to the repository-pinned
[`@ag-ui/core` **0.0.57** package](https://www.npmjs.com/package/@ag-ui/core/v/0.0.57) schemas and the
OpenCrane `opencrane.ag-ui.v2` envelope. Governed A2UI content is admitted by the contracts package's
`opencrane.a2ui.v1` parser before projection.

## See also

- Parent index: [backend conversations](../../README.md)
- Persistence and HTTP owner: [server conversations](../../../server/conversations/main/README.md)
- Wire vocabulary: [contracts](../../../../contracts/README.md)
- Browser stream client: [conversation adapter](../../../../frontend/state/conversation/adapter/README.md)
- Browser reducer: [conversation AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
