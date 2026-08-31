# @opencrane/backend/server/infra/history-store — KurrentDB event history

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › history-store

## What it owns

This package gives OpenCrane server code one narrow way to read, append, and subscribe to a
KurrentDB stream. A stream is an ordered log of events such as the history for one conversation.
It keeps the database client and its expected-revision checks outside the conversation domain.

```
 conversation or service command
             │ validated event + expected revision
             ▼
 ┌─────────────────────────────┐
 │ history-store  ◄── HERE      │
 └──────────────┬──────────────┘
                │ one named stream
                ▼
            KurrentDB
```

**In this flow:** the conversation authority and KurrentDB workload that the 0.11.0 replacement
adds after this infrastructure seam is admitted.

The adapter rejects non-object event data rather than converting it into a second wire format. It
never reads the global ledger, grants database administration, or supplies a PostgreSQL fallback.

## Public surface

- `HistoryStore` defines stream reads, checked appends, atomic checked records, transient
  subscriptions, and acknowledged persistent subscriptions for durable consumers.
- `_KurrentHistoryStore` adapts the official KurrentDB gRPC client to that port.
- `HistoryExpectedRevisions` names the missing-stream condition accepted by the port.

Persistent consumers name an already-provisioned KurrentDB group. The adapter opens that group but
does not create it, so its deployment owner must provision group settings before a consumer starts.
Each delivery is at least once: a consumer acknowledges successful work, retries a transient
failure, parks a poison event, or closes without acknowledging outstanding work. A redelivery
supersedes the prior opaque client handle, while consumers make their own handlers idempotent.

## Boundary

Callers must validate event schemas and authorise commands before using this package. This package
checks history consistency; it does not decide membership, grants, or protected effects.

## Dependency direction

Tagged `scope:history-store` at the infra layer, this package may use its own scope and shared
dependencies. It must not import a backend domain or an app entrypoint.

## Runtime & config

The composing server creates the KurrentDB client with the silo-local TLS endpoint and credential.
The adapter receives that client and reads no environment variable itself.

## See also

- Parent index: [infra](../README.md)
- Related boundary: [workload identity](../workload-identity/README.md)
