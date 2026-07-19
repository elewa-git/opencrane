# Phase D performance analysis

Status: **baseline analysis; implementation measurements required before Phase D exit**

This is the D11 performance baseline for the target product. It measures the local cryptographic
primitives that are already executable, models the amplification of the durable paths, and names
the measurements that must be run once their routes exist. It deliberately does not turn a
security check into a cache or weaken a transaction to improve a benchmark.

The topology in this report is D1: one CloudNativePG `Cluster` per ClusterTenant, with separate
logical databases and login roles for `opencrane`, `obot`, `litellm`, and `langfuse` (plus `fleet`
only in the fleet profile). This removes the previous per-authority Postgres-server fan-out; it
does not combine credentials, roles, or application pools.

## What is measurable at this commit

Some D11 paths are deliberately not implemented yet. `RunEvent` append and post-commit SSE,
model-decision boundary claims/steering absorption, and the target agent-runtime route do not
exist at this commit. Their interfaces and database constraints exist, but there is no honest
end-to-end request to time. The table labels those costs as **modelled**, not measured. The
artifact stack is also not in this branch: its costs are analysed from the reviewed
[artifact-stack recovery prerequisite (#296)](https://github.com/italanta/opencrane/pull/296),
which must merge before this report is merged.

The implemented paths are grounded in the following code:

- [`capability-proof.ts`](../../libs/backend/server/authorization/main/src/capability-proof.ts)
  performs one ES256 verification, strict compact-JWS parsing, JWK import/thumbprint, and exact
  workload/policy/action bindings.
- [`prisma-runtime-authority.ts`](../../libs/backend/server/authorization/main/src/prisma-runtime-authority.ts)
  holds lock-ordered authority transactions for bootstrap consumption and action receipts.
- [`prisma-run-authority.ts`](../../libs/backend/agents/personal/runs/main/src/prisma-run-authority.ts)
  locks service then run, changes the attempt, and writes an outbox event in one transaction.
- The #296 artifact-stack prerequisite's `artifact-lease.ts` and `artifact-promotion.ts` verify/sign
  Ed25519 JWTs and hash the promoted byte stream. Those files are intentionally not local links:
  this D11 worktree does not contain that prerequisite yet.
- [`tenant-contract.ts`](../../libs/backend/server/contract/main/src/routes/internal/tenant-contract.ts)
  and [`participation.ts`](../../libs/backend/server/awareness/main/src/routes/internal/participation.ts)
  each issue an uncached Kubernetes `TokenReview` with a fixed audience and validate the returned
  ServiceAccount identity.

## Measured crypto baseline

Measurements below were taken on 2026-07-19 with Node `v22.15.0` on the local Darwin `arm64`
host. The committed [benchmark](../../scripts/phase-d-performance-crypto-benchmark.mjs) generates
the keys and inputs outside timed work, runs 200 warm-up operations, then takes 21 batches: 1,000
signature operations, 10,000 4 KiB hashes, or 100 1 MiB hashes per batch. It uses ascending-sort
median and nearest-rank p95 (`ceil(0.95 * 21) - 1`); the exact captured
[raw JSON](phase-d-performance-crypto-benchmark-2026-07-19.json) is the source of the table.
Run `node scripts/phase-d-performance-crypto-benchmark.mjs` to reproduce it. These are CPU-only
primitive measurements, not request latency and not a capacity promise for a production node.

| Primitive | Median | p95 | Interpretation |
|---|---:|---:|---|
| ES256 verify | 76.10 microseconds | 92.08 microseconds | Lower bound for the signature portion of one capability proof. Full proof verification also parses, imports the JWK and compares bindings. |
| Ed25519 verify | 82.68 microseconds | 92.22 microseconds | Lower bound for artifact write-lease or receipt verification. |
| Ed25519 sign | 34.94 microseconds | 53.04 microseconds | Receipt signature after successful artifact promotion. |
| SHA-256, 4 KiB | 4.98 microseconds | 5.75 microseconds | Fixed/small-artifact hashing cost. |
| SHA-256, 1 MiB | 663.41 microseconds | 704.07 microseconds | About 0.66 ms/MiB CPU lower bound; at 100 MiB this is about 66 ms before read/write I/O and promotion. |

Repeat the primitive benchmark on the target runtime image and node class before adopting these
figures as a capacity number. In particular, do not extrapolate the 1 MiB hash throughput through
PVC, filesystem, antivirus/scanning, or network contention.

## Per-step cost and amplification

| Added step | Invocation frequency | Cost at this baseline | Throughput/latency consequence | Status and evidence |
|---|---|---|---|---|
| Capability-proof verification | Once for every authorized runtime action. | At least one ES256 verify (76.10 us median locally), plus two public-key imports in the current verifier, thumbprint SHA-256, parsing, and constant-size comparisons. | CPU cost is O(actions), not O(events); no network round trip. At 20 actions, ES256 alone is about 1.52 ms CPU median across the run. | Implemented. The verifier intentionally does not cache proofs: its `htu`, method, capability, workload, run-attempt and policy bindings are request-specific. |
| Kubernetes `TokenReview` | Once per protected controller/internal request, including the current tenant-contract and participation routes; planned controller-authority, channel-target and artifact-lease callers follow the same pattern. | One API-server RPC plus serialization and returned-audience/identity comparison. No success-cache is present. | Network/API-server bound, so it can dominate the small crypto costs. Exact p50/p95 are **unmeasured** without a live cluster. | Implemented on existing internal routes; target caller count is still incomplete. Reuse the Kubernetes HTTP client connection, but do not add a positive-result cache by default because revocation and projected-token expiry are security inputs. |
| Run-ingest commit before SSE | Once per visible normalized model/tool/approval/artifact/status callback. | One durable `RunEvent` append transaction must commit before the event is exposed; projection should use the committed returned row/cursor, not a second read. | O(events), therefore the likely dominant path for long streamed runs. A run with `E` visible events has `E` durable commits and at least `E` client projections. | Modelled: the conversation authority interface and SQL fences exist, but no run-ingest/SSE route exists to time. |
| Fenced model-decision boundary claim and steering absorb/defer | Once per model-decision boundary, not per token chunk. | One idempotent/lock-aware transaction to claim the boundary and persist any absorbed/deferred steering result. | O(boundaries). It should remain far below event writes when one boundary covers many emitted events. | Modelled: no steering inbox, boundary-claim implementation, or `steering.deferred` persistence exists yet. |
| Authority-repository transactions | Per state transition: bootstrap consume, action receipt reserve/complete/fail, run-attempt start, artifact finalization, controller claim/record/finalize. | Several `SELECT ... FOR UPDATE` statements followed by canonical writes/outbox in one Postgres transaction. The exact query count varies by authority. | Lock wait and fsync/commit latency, not JavaScript CPU, set the tail. Contention serializes the same run/JTI/assignment, deliberately preventing double execution. | Partly implemented. Must be timed against the live authority suite with both uncontended and same-key contention. |
| Artifact lease, receipt, stage/hash/promote | Once per artifact upload; lease verify before byte staging, receipt sign after promotion. | Ed25519 verify (82.68 us lower bound), Ed25519 sign (34.94 us lower bound), and O(bytes) SHA-256. | For 1 MiB, hash CPU lower bound is 0.66 ms; byte I/O and atomic filesystem promotion dominate for larger artifacts. At 100 MiB the hash alone is about 66 ms locally. | Analysed from the required #296 artifact-stack prerequisite, not implemented in this D11 worktree. The same artifact is not rehashed for every consumer; content addressing pays the cost at promotion. |
| Per-logical-database connections after D1 | Steady-state: each deployed client process owns its own pool to its authoritative logical database. | One CNPG server/instance process replaces four physical Postgres servers; separate role/database credentials and client pools remain. No pool limit is configured in the chart or app values. | Lower server/process/PVC overhead, but connection exhaustion is now shared by all logical databases on the one instance. | Implemented D1 topology. A tenant connection budget is required before load testing; no numeric pool claim is defensible yet. |
| Cilium default-deny and identity-bound policy | Datapath policy lookup while matching traffic; policy/identity work is not an application request RPC. | eBPF datapath policy evaluation; no repository benchmark or target-node Cilium/Hubble sample exists. | It is expected to be materially smaller than a Postgres commit or API-server RPC, but that is an inference, not a measured result. | Rendered/live enforcement contracts exist; measure connection setup and throughput with policy on/off only in an isolated test cluster, never by weakening the production default-deny policy. |

## Long-run model

For a representative *illustrative* long task, let:

- `E` be visible events (for example, 300);
- `A` be authorized runtime actions (for example, 20);
- `B` be model-decision boundaries (for example, 3);
- `I` be protected internal/controller requests; and
- `T` be authority state transitions.

The durable/request-path work is:

```text
Run-event commits/projections: E
Capability-proof verifications: A
TokenReview RPCs: I
Fenced boundary transactions: B
Authority transactions: T
Artifact work: sum(upload bytes) + uploads
```

At `E=300`, the future ingest route must sustain 300 ordered durable appends before it can claim
smooth streaming; at `A=20`, the measured ES256 primitive component is only about 1.52 ms median
CPU across the whole run. This comparison makes the priority clear: event persistence and remote
checks need end-to-end measurement before optimizing local proof verification.

## Top three targets

1. **Run-event append and post-commit projection.** Build the route with one atomic append that
   returns the committed event/cursor; record commit duration, lock wait, event byte size, and
   commit-to-SSE latency. Test 1, 50, and 300-event runs plus reconnect/replay. Do not batch across
   the required visible-order/commit boundary without a replacement correctness proof.
2. **`TokenReview` API-server round trips.** Add an outcome-labelled duration histogram at each
   caller and load-test the target service-account audience. Reuse the HTTP connection and remove
   accidental repeated calls within one request. Keep per-request verification as the default;
   any bounded cache would need an explicit revocation/freshness contract and a security review.
3. **Postgres lock/connection budget.** Run the authority suite against the one-Cluster D1 setup
   with uncontended and same-key contenders, then set a tenant-wide maximum connection budget and
   explicit per-app pool ceilings. Watch transaction duration, lock wait, active/idle connections,
   and connection acquisition wait. This protects the shared physical instance without merging
   authority roles or credentials.

Artifact hashing is the next target when expected upload volume or size is high; its cost is
linear and easily forecast from bytes. Capability-proof crypto is not an optimization target until
profiles show action rates large enough for its measured sub-millisecond primitive cost to matter.

## Required live measurement gate

Run this after the route-owning slices land and against the D1 topology, not against a legacy or
per-authority-server profile:

1. Bring up the pinned local Postgres/CNPG acceptance environment and run
   [`phase-d-authority-integration.sh`](../../apps/opencrane/prisma/tests/phase-d-authority-integration.sh)
   with `DATABASE_URL` for the `opencrane` logical database. Add timing for every authority
   transaction and a same-key contention case; report p50/p95/p99 and throughput.
2. Run the run-ingest/SSE load fixture at 1, 50, and 300 events per run. Capture append commit,
   projection, reconnect replay, and database lock metrics separately.
3. Run protected callers against a live API server with their real projected-token audience. Capture
   `TokenReview` p50/p95/p99, API-server errors, and the number of reviews per successful request.
4. Upload 4 KiB, 1 MiB, and 100 MiB artifacts through the service, separating lease verification,
   hash/stage, filesystem promotion, receipt signing, and catalog finalization.
5. Repeat the suite with the target Cilium profile enabled. Compare only equivalent allowed traffic;
   report connection setup, sustained throughput, drops, and policy verdicts from the datapath.

The Phase D exit report must include the command/image/node class, database storage class, event
and action counts, concurrency, warm-up, percentile method, raw sample location, and both success
and rejected-request results. Without those, values in this document remain a planning baseline,
not an SLO or capacity commitment.
