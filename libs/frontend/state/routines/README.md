# @opencrane/state/routines — routine gateway port

> [frontend](../../README.md) › [state](../README.md) › routines

## What it owns

This package defines the browser-facing port for authenticated routine reads and commands. It
keeps cursors opaque, exposes only generated public DTO aliases, and gives features typed failure
categories without granting browser policy authority.

```
 routines feature ──intents──► routine gateway port  ◄── HERE
                                      ▲
                              live generated-client adapter
                                      │
                              authenticated routine API
```

## Public surface

- `ROUTINE_GATEWAY` — injection token for the transport-neutral `RoutineGateway`.
- `ROUTINE_SESSION` — app-supplied signed-in subject and silo signal used by feature state.
- `RoutineGateway` — list, detail, history, options, requester-only proposal reads/cancellation,
  preview and seven command methods.
- `RoutineGatewayError` and `RoutineGatewayErrorKinds` — safe browser error vocabulary.
- Routine DTO aliases, response validators and the public status, trigger, disposition, terminal
  reason and refusal enums used by feature mappers.

## Boundary

The state package never decides whether a caller may create, revise, run or retire a routine. The
server remains the authority for identity, audience, lifecycle, permissions, cursors and results.
Proposal projections are browser-safe suggestions only; creation remains a human-reviewed mutation,
and an opaque proposal reference does not grant activation authority.

For `Unavailable`, `Unknown` or `InvalidResponse` after a mutation request, the outcome is
unconfirmed: the server may have committed the command even though the browser did not receive a
usable response. Feature state must reread current state and recover with the same idempotency key
and the same payload when the endpoint supports recovery. This port never automatically replays a
mutation, and callers must not claim that an unconfirmed command was not committed.

## Dependency direction

Tagged `scope:routines`, `type:lib`, `layer:frontend`, and `frontend-role:state`. It may depend on
shared contracts and frontend core, but never on the feature, adapter, app or backend packages.

## See also

- Parent index: [state](../README.md)
- Live adapter: [routines adapter](./adapter/README.md)
- Consumer feature: [routines](../../features/routines/README.md)
