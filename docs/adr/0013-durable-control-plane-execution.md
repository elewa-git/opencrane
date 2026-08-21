# ADR 0013 — Durable control-plane execution

- **Status:** Accepted
- **Date:** 2026-08-20
- **Task:** [#695](https://github.com/elewa-git/opencrane/issues/695)
- **Related:** [#592](https://github.com/elewa-git/opencrane/issues/592) ·
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md) ·
  [ADR 0009](0009-governed-sandbox-jobs.md)

## Context

OpenCrane has several control-plane operations that must survive a process crash, avoid duplicate
effects, wait for approved input, and resume after an external operation. New work for the MCP
serving and warm-path programme needs these properties, but it must not add another Postgres lock
ladder or a separate workflow platform to each silo.

Absurd 0.5.0 stores task, checkpoint, event, cancellation, and retry state in a pinned schema in
the existing silo PostgreSQL database. Its TypeScript SDK owns a separate PostgreSQL pool. Prisma
does not expose its transaction connection to that SDK, so an SDK call after a product transaction
commits could be lost if the process stops between the two operations.

The engine supports task checkpoints, events, cancellation, in-task sleep, and child-task result
waiting across queues. It does not provide a generic recurring-task API. Its optional cron support
maintains its own storage and requires the `pg_cron` extension.

## Decision

- OpenCrane uses Absurd behind the `workflows/contract` port for new asynchronous control-plane
  work. The port owns task spawn, child await, event, cancellation, checkpoints, and worker
  lifecycle. It deliberately has no generic schedule or recurring-schedule operation.
- The port uses a version-pinned, blessed same-transaction adapter. That adapter is the sole
  OpenCrane production caller of `absurd.spawn_task`; it calls the vendored 0.5.0 function through
  the caller's Prisma transaction and supplies the domain-derived, stable idempotency key. A task
  is therefore admitted or rolled back with the product decision that requested it.
- The adapter is the only future exception to the repository-wide raw-Prisma prohibition. It is
  constrained to the vendor function and version in `workflows/infra_absurd`; no domain package
  imports the SDK or engine schema.
- Recurring work uses a scheduler-owned respawn chain. Each completed iteration derives and
  idempotently spawns its next slot as a new task. The chain-head ensure operation repairs a
  terminated chain. An iteration never remains asleep forever because its checkpoint journal would
  grow without bound.
- Product cron interpretation, timezone rules, Kubernetes Job cleanup, and existing aggregate
  writers keep their current owners until their explicit whole-aggregate migration. No current
  outbox or lock path dual-writes to Absurd.
- Absurd workers run inside the existing OpenCrane server process. They do not add a deployment,
  service account, ingress, RBAC grant, or Kubernetes mutator. The deploy path must prove that the
  target CNPG image provides `pg_cron` before applying the engine schema.

## Alternatives considered

- **Spawn after commit with a retrying recovery path** — rejected. A deterministic key prevents
  duplicate tasks but cannot prove that a process crash did not lose the first spawn. Persisting and
  recovering that missing request would recreate a second orchestration outbox.
- **Expose the engine cron as the product schedule API** — rejected. It is internal maintenance,
  depends on `pg_cron`, and cannot represent OpenCrane's user-defined timezone and slot authority.
- **Keep an immortal sleeping task for every recurrence** — rejected. Its checkpoint journal grows
  for the life of the schedule and makes retention depend on a process that may never return.
- **Adopt Argo, Tekton, or Kestra for this control plane** — rejected. They add a separate mutator
  or platform and move orchestration state outside the existing PostgreSQL transaction boundary.
- **Adopt DBOS Transact now** — deferred. It remains the swap candidate if the identical contract
  tests or live gates disqualify Absurd.

## Consequences

- The schema, adapter, contract tests, and import boundary make the engine replaceable without
  making Absurd identifiers part of a domain or API contract.
- Every new task spawn that accompanies a product write must use the transaction-bound adapter and
  a stable domain key. Calling the SDK after commit is not an allowed shortcut.
- The Phase 0 live latency gate decides whether warm-pool claims can use the engine. A failure
  leaves the latency-critical claim path on its existing CAS design while other suitable workflows
  may proceed.
- Existing raw SQL, outbox workers, scheduler ticker, runtime repair, and cleanup stay unchanged
  until their direct replacements are complete. The eventual raw-Prisma boundary admits only the
  adapter named above.
