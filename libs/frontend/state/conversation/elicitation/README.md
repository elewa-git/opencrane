# @opencrane/state/conversation/elicitation — recoverable participant input

> [frontend](../../../README.md) › [state](../../README.md) › conversation › elicitation

## What it owns

This package owns browser state for one server-authoritative question or approval. It reads the
generic request, keeps a selected draft separate from submission, admits one response command at a
time, restores that draft after verified sign-in, and adopts only the server's returned lifecycle.

It also maps canonical request references and safe tool histories into Activity rows. It never
creates a run, chooses the respondent, interprets protected A2UI actions, or reads personal memory.

## Public surface

- `ConversationElicitationStore` — component-scoped command, draft, step-up, and reconciliation state.
- `OpenCraneConversationElicitationGateway` — generated-client adapter for request, response, and Activity reads.
- `__MapElicitationActivity` and `__MapToolActivity` — pure canonical-reference mappers.

## Dependency direction

Tagged `scope:conversation-elicitation`; depends only on shared browser/core contracts. The feature
packages render this state. The workspace route is mounted later by issue #351.

## See also

- Parent index: [`libs/frontend/state`](../../README.md)
- Elicitation controls: [`elements/elicitation`](../../../elements/elicitation/README.md)
- Activity feature: [`features/conversation-activity`](../../../features/conversation-activity/README.md)
