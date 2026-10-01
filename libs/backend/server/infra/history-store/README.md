# @opencrane/backend/server/infra/history-store — KurrentDB event history

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › history-store

## What it owns

`src/connection/` owns mounted-credential connection setup and the silo sentinel. Startup must
complete the silo guard before any worker reads or appends history.

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

- `_CreateHistoryStoreComposition` creates the authenticated client and exposes its close operation.
- `_AssertHistoryStoreSilo` prevents two silos from sharing the same history database.

- `HistoryStore` defines stream reads, checked appends, atomic checked records, transient
  subscriptions, and acknowledged persistent subscriptions for durable consumers.
- `_KurrentHistoryStore` adapts the official KurrentDB gRPC client to that port.
- `HistoryExpectedRevisions` names the missing-stream condition accepted by the port.

`readStream` yields no events for a stream that has not been created, allowing a caller to make its
first append with `NoStream`. Authentication, transport, deleted-stream, malformed-event, and
cancellation failures remain errors. It keeps its full finite-read behavior when no options are
supplied. A bounded read names
`maxCount` and may pass an `AbortSignal`. The installed SDK's Rust read iterator cannot cancel an
in-flight request, so these bounded reads use its closeable catch-up subscription and finish at the
requested count or `caughtUp`. Cancellation and normal completion both unsubscribe upstream.
The adapter requests a one-object readable buffer; gRPC also has its own bounded transport buffers.

Persistent consumers name an already-provisioned KurrentDB group. The adapter opens that group but
does not create it, so its deployment owner must provision group settings before a consumer starts.
Each delivery is at least once: a consumer acknowledges successful work, retries a transient
failure, parks a poison event, or closes without acknowledging outstanding work. A redelivery
supersedes the prior opaque client handle, while consumers make their own handlers idempotent.
Parked replay requires KurrentDB operations or administrator authority and is deliberately absent
from this application port. The deployment maintenance command `--kurrentdb-replay-parked` replays
the installed silo's activation group after its cause is repaired, using the bootstrap trust boundary.
The server keeps its unprivileged history identity.

## Boundary

Callers must validate event schemas and authorise commands before using this package. This package
checks history consistency; it does not decide membership, grants, or protected effects.

## Dependency direction

Tagged `scope:history-store` at the infra layer, this package may use its own scope and shared
dependencies. It must not import a backend domain or an app entrypoint.

## Runtime & config

The connection factory receives `OpenCraneHistoryStoreConfig`: a silo-local TLS endpoint, certificate
authority file and mounted username/password paths. It validates the fixed `opencrane-history`
service identity and opens the client. The adapter receives that client; neither reads process
environment variables.

### One KurrentDB instance per silo

Stream names such as `conversation-{id}` and `conversation-computer-{id}` carry no silo id, so silo
isolation depends on every silo owning its own KurrentDB endpoint. The OpenCrane server checks that
at startup (`src/connection/history-store-silo-guard.ts`). The first server to start writes
one event of type `opencrane.silo.v1` to the well-known stream `opencrane-silo`, carrying its
configured silo id and fenced with the `NoStream` expected revision so two racing replicas cannot
both create it. Every later start reads that event and compares it with its own silo id: a match
starts normally without writing again, a mismatch stops the process before any worker reads or
appends a stream. A malformed sentinel also stops the process. Pointing a second silo at an existing
database therefore fails at boot instead of silently mixing histories; a fresh silo needs a fresh
database.

## Live proofs against a real KurrentDB

The unit tests under `src/__tests__/*.test.ts` mock the client. ADR 0016 also requires proof that
the real `@kurrent/kurrentdb-client` and a real KurrentDB 26.x support every operation on the port,
so `src/__tests__/kurrent-history-store.integration.ts` runs the adapter against a live server. It proves
checked single-stream appends, the atomic multi-stream append used for genesis and for
message+activation, the exact `WrongExpectedVersionError` the authorities catch (including a
two-writer race and a stale head that rolls the whole atomic append back), reads, catch-up
subscriptions, and the persistent consumer group with acknowledge, retry, park, and replay, using the
same group settings the Helm bootstrap Job provisions. Replay uses the test's privileged client
directly; the deployment maintenance tests and live drill qualify its separate operator boundary.

Run them with a server reachable from this machine:

```
KURRENTDB_INTEGRATION_URL='kurrentdb://localhost:2113?tls=false' \
  npx nx run backend-server-infra-history-store:test:integration
```

Without `KURRENTDB_INTEGRATION_URL` the target still compiles the suite and reports one skipped
block per file. The default `test` target never runs these files. CI starts KurrentDB 26.1.1 as a
service container in the "KurrentDB history-store proofs" job of `.github/workflows/docker.yml`;
that container runs insecure on purpose because TLS, credentials, and the ACL are proven by the
Helm contract test and bootstrap Job under `apps/_infra/kurrentdb`.

The conversation package owns its higher-level conflict and saved-answer recovery proofs in
`backend-server-conversations:test:integration`. CI runs that target against the same server after
this adapter target. The history-store target does not collect another package's tests.

## See also

- Parent index: [infra](../README.md)
- Related boundary: [workload identity](../workload-identity/README.md)
