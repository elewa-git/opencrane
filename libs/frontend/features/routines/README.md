# @opencrane/features/routines — routine screens

> [frontend](../../README.md) › [features](../README.md) › routines

## What it owns

This package owns the lazy routine list, chat-bound creation form, detail controls, revision form,
and firing-history presentation. Route-scoped stores retain opaque cursors and retry keys, discard
protected values when the signed-in session changes, and cancel outstanding browser requests when a
route is destroyed.

## Public surface

- `ROUTINE_ROUTES` — authenticated lazy routes mounted at `/routines` by app composition.

## Boundary

The browser presents server-approved participants, assistants, command hints, previews, and result
links. It does not infer authority, decode cursors, calculate occurrences, or create routines from a
typed conversation identifier. Standard creation starts from an open chat.

A requester-only conversation proposal opens the same reviewed form through
`/routines/new?proposalRef=...`. The route reads the authorized source conversation before loading
creation choices, seeds only a Pending suggestion, and submits final human-edited values with the
opaque reference. Accepted, cancelled, expired, unreadable, and access-lost proposals never
activate or display protected suggestion values; explicit cancellation is a separate request.

An uncertain mutation keeps its original retry key and payload until the person explicitly retries
the same action or leaves the route. Aborting browser work prevents late UI changes; it does not
claim that a server mutation was undone.

## Component states

- list: loading, ready, sparse continuation, retained-error, unavailable, access-changed;
- editor: creation, revision, preview-pending, stale-preview, conflict, uncertain;
- details and history: ready, command-pending, committed-refresh-failed, retired, empty history.

Storybook fixtures document these states without approving new screenshot baselines.

## Dependency direction

Tagged `scope:routines`, `type:lib`, `layer:frontend`, and `frontend-role:feature`. It imports the
routine state port and shared UI elements, never the live adapter, another feature, an app, or a
backend package.

## See also

- State port: [routines state](../../state/routines/README.md)
- Feature index: [features](../README.md)
