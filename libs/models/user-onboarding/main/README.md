# @opencrane/models/user-onboarding — validated persona-onboarding projections

> [models](../../README.md) › user onboarding

## What it owns

This pure model package defines both resumable projections returned during persona onboarding: the
reviewed survey, scoring result, and approval lifecycle; then the one-time first chat. It keeps the
server-owned states, frozen questions and source evidence, ordered transcript, answer count, and
completion evidence in dependency-bottom values shared by live adapters and frontend state.

Used by: frontend onboarding state · the conversation workspace's read-only history adapter.

Its validators check field bounds and relationships between fields. A persona projection cannot
miscount selected answers or omit required tie/review evidence, while a first-chat projection cannot
claim completion with missing answers, reorder transcript evidence, or invent a conversation for a
migrated completed account.

## Public surface

- `PersonaOnboardingSnapshot` and its nested value types — the reviewed survey, tie, review, and
  ready projection.
- `PersonaOnboardingStates`, `PersonaResolutionKinds`, `PersonaColours`, and `PersonaModifiers` —
  the closed persona vocabulary shared across adapters and state.
- `___ParsePersonaOnboardingSnapshot` — strips response extensions and rejects malformed or
  internally inconsistent persona projections.
- `PersonaFirstChatSnapshot` and its nested value types — the complete server projection.
- `UserOnboardingRouteStates` and the first-chat categorical enums — the finite projection vocabulary.
- `___ParsePersonaFirstChatSnapshot` — strips documented extensions and rejects malformed or
  internally inconsistent runtime values before consumers can adopt them.

## Boundary

This package validates response values only. It does not score survey answers, own persistence or
workflow transitions, make HTTP calls, route screens, store browser state, admit user commands, or
own canonical conversations. The server remains the authority for every onboarding transition.

## Dependency direction

Tagged `scope:user-onboarding` and `layer:model`: it is dependency-bottom pure TypeScript and may
import only same-scope or shared model dependencies. It never imports frontend, backend,
infrastructure, generated-client, or application code.

## See also

- Parent index: [models](../../README.md)
- Consumers: [frontend onboarding state](../../../frontend/state/onboarding/README.md) · [conversation workspace adapter](../../../frontend/state/conversation/workspace/adapter/README.md)
