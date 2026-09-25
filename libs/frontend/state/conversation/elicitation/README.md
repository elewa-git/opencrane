# @opencrane/state/conversation/elicitation — recoverable participant input

> [frontend](../../../README.md) › [state](../../README.md) › conversation › elicitation

## What it owns

This package owns browser state for one server-authoritative question or approval. It reads the
generic request, keeps a selected draft separate from submission, admits one response command at a
time, restores that draft after verified sign-in, and adopts only the server's returned lifecycle.
It discovers the oldest current request when a conversation is selected, preserves a draft across
harmless refreshes, and performs one exact authority read when the request deadline arrives.

The component-scoped Activity store reads pending requests for the signed-in participant while its
page is visible. It partitions private rows by the verified session identity, drops expired rows at
their server deadline, and stops recurring reads when access changes until an explicit retry.

It also maps canonical request references and safe tool histories into Activity rows. It never
creates a run, chooses the respondent, interprets protected A2UI actions, or reads personal memory.
Its shared `ConversationActivityRow` accepts a personal-run status row with an optional answer
target and nullable public tool phase. The phase has no tool identity or private payload, and a
result received phase does not mean that the assistant has completed its answer. The workspace
feature derives that row from its authorized run read and currently rendered transcript. The target
grants no access and does not copy an answer into this state package.

## Public surface

- `ConversationElicitationStore` — component-scoped discovery, cancellable reads, command, draft,
  deadline, step-up, and authoritative reconciliation state.
- `ConversationElicitationActivityStore` and `ConversationElicitationActivityReadStates` —
  component-scoped visible-page refresh, identity fencing, pending badge count, and read feedback.
- `OpenCraneConversationElicitationGateway` — generated-client adapter for selected-conversation
  pending lists, named request reads, responses, and Activity reads.
- `__MapElicitationActivity` and `__MapToolActivity` — pure canonical-reference mappers.
- `ConversationActivityKinds`, `ConversationActivityRow`, and `RunToolProgressPhases` — the derived row vocabulary and public tool-phase categories used by the Activity feature.
- `__CanApproveElicitation` — checks that affirmative drafts have reviewable arguments and valid tool-connection disclosure; this never grants server permission.
- `ToolApprovalScopeStore`, `ToolApprovalScopeGateway`, and `OpenCraneToolApprovalScopeGateway` —
  current-requester pagination, per-scope revocation, uncertain retry identity and authoritative
  result adoption through the generated client.
- `ElicitationExecutionConnection`, `ElicitationConnectionOwnerKinds`, `McpCredentialRequirement`, and `___ElicitationExecutionConnectionSchema` — re-export the shared disclosure model and validator for feature mapping without bypassing the state package's public API.

## Boundary

Tool approvals must include the saved connection owner and credential requirement. The browser
uses the shared strict validator, rejects unknown disclosure fields, and preserves the reviewed
labels unchanged. Other approval purposes omit this disclosure. The store checks it again when
choosing and submitting, including when a refresh retains an older draft. Denial remains available
when tool details are incomplete; the server still decides whether to accept any response.

Standing approvals are current-requester consent records, not tool grants. Identity changes purge
their safe summaries, opaque cursors and saved retry keys. Independent scopes may revoke in parallel,
while a second command for the same scope is refused. An uncertain retry reuses its saved key, and
the list follows only the server's opaque continuation cursor so older approvals remain reachable.

## Dependency direction

Tagged `scope:conversation-elicitation`; depends only on shared browser/core contracts. The feature
packages render this state. The conversation workspace composes the Activity feature.

## See also

- Parent index: [`libs/frontend/state`](../../README.md)
- Elicitation controls: [`elements/elicitation`](../../../elements/elicitation/README.md)
- Activity feature: [`features/conversation-activity`](../../../features/conversation-activity/README.md)
