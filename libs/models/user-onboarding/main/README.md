# @opencrane/models/user-onboarding — validated first-chat projection

> [models](../../README.md) › user onboarding

## What it owns

This pure model package defines the complete resumable projection returned for a user's one-time
first chat after persona approval. It keeps the server-owned route, frozen persona and question-set
evidence, ordered transcript, answer count, and completion evidence in one coherent value.

Used by: frontend onboarding state · the conversation workspace's read-only history adapter.

Its validator checks field bounds and the relationships between fields. A projection cannot claim
completion with missing answers, present a next question that disagrees with the durable answer
count, reorder transcript evidence, or invent a conversation for a migrated completed account.

## Public surface

- `PersonaFirstChatSnapshot` and its nested value types — the complete server projection.
- `UserOnboardingRouteStates` and the first-chat categorical enums — the finite projection vocabulary.
- `___ParsePersonaFirstChatSnapshot` — strips documented extensions and rejects malformed or
  internally inconsistent runtime values before consumers can adopt them.

## Boundary

This package validates response values only. It does not own persistence, workflow transitions,
HTTP calls, routing, Angular stores, user commands, or canonical direct, group, and Agent-session
conversations. The server remains the authority for every onboarding transition.

## Dependency direction

Tagged `scope:user-onboarding` and `layer:model`: it is dependency-bottom pure TypeScript and may
import only same-scope or shared model dependencies. It never imports frontend, backend,
infrastructure, generated-client, or application code.

## See also

- Parent index: [models](../../README.md)
- Consumers: [frontend onboarding state](../../../frontend/state/onboarding/README.md) · [conversation workspace adapter](../../../frontend/state/conversation/workspace/adapter/README.md)
