# @opencrane/state/routines/adapter — live routine API adapter

> [frontend](../../../README.md) › [state](../../README.md) › routines › adapter

## What it owns

This package maps the generated signed-in control-plane client onto the routine state port. It
validates every successful response, sends no retries or cache writes, and converts HTTP status
categories into safe typed errors without exposing server prose.

An `Unavailable`, `Unknown` or `InvalidResponse` from a mutation does not prove that the command
was not committed. The owning feature must reread current state and recover with the same
idempotency key and same payload where the endpoint supports recovery. This adapter never
automatically replays a mutation.

## Public surface

- `OpenCraneRoutineGateway` — the live `RoutineGateway` implementation bound by app composition.

## Boundary

The adapter owns transport and response validation only. The server owns session authority,
audience, lifecycle, cursor, spending and result permissions; malformed or unknown responses fail
closed.

## Dependency direction

Tagged `scope:routines`, `type:lib`, `layer:frontend`, and `frontend-role:adapter`. It may import
the routine state port and shared core HTTP client, but never a feature, app or backend package.

## See also

- Parent package: [routines state](../README.md)
- Consumer feature: [routines](../../../features/routines/README.md)
