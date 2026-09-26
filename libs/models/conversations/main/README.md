# @opencrane/models/conversations — immutable conversation modes and decisions

> [models](../../README.md) › conversations

## What it owns

This pure model package defines a **Conversation**, the durable record behind a user-facing Chat. It
owns three immutable modes: an `agent_session` routes participant input through governed agent runs,
while `direct` and `group` conversations admit ordinary messages without inventing runs.

It also owns the open-to-closed lifecycle, participant-specific visible-from, read-through,
access-ended, and archive coordinates, canonical messages, and the monotonically positioned mixed
timeline. An exhaustive mode strategy
decides where each write must go. Steering and elicitation can target only the exact active run in an
open agent session; unknown commands, invalid agent bindings, wrong modes, and closed conversations
deny without choosing a write authority.

Used by: conversation backend authorities · public contracts · workspace clients.

Invariant: an agent session has exactly one agent service, direct and group conversations have none,
mode never changes, and closure is permanent. Access ending prevents later writes and caps later
reads at the recorded position. Timeline positions come from the persistence authority; this package
only checks deterministic model rules and never allocates a position itself.

## Public surface

- `Conversation`, `ConversationModes`, and `ConversationLifecycles` — the exact immutable-mode and
  monotonic-lifecycle aggregate.
- `ConversationCreationRequest` and `___ConversationCreationRequestSchema` — the shared strict
  request vocabulary that keeps transport validation aligned with immutable modes.
- `ConversationParticipant`, `Message`, `ConversationTimelineEntry`, and `ConversationReplayCursor`
  — canonical membership, message, ordering, and replay coordinates. A cursor may include a
  last observed position so a history reader resumes between complete immutable entries.
- `GroupChildCreateCommand` and `___GroupChildCreateCommandSchema` require explicit additional
  organisation membership references in `participantRefs`. An empty array selects only the requester.
  References remain opaque and case-sensitive; unique selections are sorted for stable retries.
  The server still checks each selected person's current membership and access to the parent message.
- `GroupChildView`, `GroupChildOrigin`, and their `___GroupChild*Schema` validators preserve public
  child creation progress and source coordinates. Strict validation rejects extra fields, self-parenting
  views, and revisions outside the unsigned 64-bit stream range; an enclosing conversation must also
  reject an origin that names itself as parent. These values do not grant access or imply run success.
- `ConversationGenesisOrigin`, `ConversationGenesisOriginKinds` and
  `___ConversationGenesisOriginSchema` define the closed provenance stored with derived agent-session
  history. Group-child origins wrap the unchanged relational source model. Routine-occurrence origins
  bind one firing and positive safe revision to its original destination; automatic firings require an
  ISO-8601 slot and manual firings require null. Unknown fields and legacy origins without a kind fail.
- `__DecideConversationCommand` and the `ConversationCommand*` enums/types — the exhaustive
  State-by-Command and immutable-mode strategy decision.
- `__HasValidConversationAgentBinding`, lifecycle/message/timeline invariant helpers, and the
  `___*Schema` exports — pure guards and strict model-adjacent Zod validation.

## Boundary

This package owns values, validation, and deterministic decisions only. It does not authenticate a
participant, admit a run, write a message, allocate a timeline position, persist state, or project a
run event. Those authorities consume an allowed action and still enforce their own transaction and
authorization boundaries.

## Dependency direction

Tagged `scope:conversations` (`layer:model`): it uses the canonical `RoutineFiringTrigger` from
[agent models](../../agents/main/README.md) for routine provenance. That dependency is one-way;
agent models do not import conversation models. It imports no backend, frontend, infrastructure or
application packages.

## See also

- Parent index: [models](../../README.md)
- Siblings: [agents](../../agents/main/README.md) · [artifacts](../../artifacts/main/README.md) · [authorization](../../authorization/main/README.md)
