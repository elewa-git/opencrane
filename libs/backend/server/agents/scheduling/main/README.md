# @opencrane/backend/server/agents/scheduling — managed-agent schedule semantics

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › scheduling

## What it owns

This package is the **scheduler brain** for managed (central) agents. A managed agent can carry a
recurring *schedule* — a cron expression evaluated in a timezone. This package turns that schedule
plus the current time into the exact set of runs that are due, and asks the existing run-admission
authority to admit each one. It does not run anything itself: it only decides *when* a run should
exist and records that request through the existing admission seam.

It is composed INSIDE the control API process (`apps/opencrane`), not a separate worker — a schedule
tick uses the same identity and privilege as the rest of the control plane. Catch-up is handled by a
bounded lookback window rather than leader election: a tick that runs late simply sees every missed
slot inside the window and admits them oldest-first.

```
 AgentServiceSchedule (cron · timezone · overlap policy · enabled · catch-up window · last slot)
        │  evaluate against "now"
        ▼
 ┌──────────────────────────────────┐
│  scheduling  ◄── HERE             │  which minute-slots are due? overlap? suspended?
│                                   │  key = sha256(service + revision + slot)
 └──────────────────────────────────┘
        │  admit due slot(s)  (trigger: schedule)  through the EXISTING ManagedRunAdmissionPort
        ▼
 agent-services run admission  ->  one AgentRun per slot (deduped by @@unique([siloId, key]))
```

**In this flow:** [agent-services](../../agent-services/main/README.md) *(owns the admission port + the run substrate)*

Invariant: the scheduler opens **no second run-creation path**. Every due slot is admitted through
`ManagedRunAdmissionPort.admitManagedRun` with `trigger: schedule` and the deterministic idempotency
key `sha256(agentServiceId + agentRevisionId + scheduledSlot)`. Because the key encodes the slot,
two concurrent ticks collapse to one durable run on the existing `@@unique([siloId,
requestIdempotencyKey])` — one tick sees `accepted`, the other `idempotent`. A disabled schedule is
suspended (no evaluation); a malformed cron or timezone fails closed. The cursor is a final
version-and-old-cursor compare-and-set (CAS): a concurrent tick or a schedule edit wins cleanly,
and a stale tick cannot overwrite its newer position.

For overlap, `allow` admits every due catch-up slot. `skip` admits only the oldest due slot when no
prior scheduled run is active, and skips every due slot when a prior scheduled run is active. That
keeps a delayed scheduler from creating a burst of concurrent runs for the same managed agent.

## Public surface

- `__RunScheduleTick` — evaluate one schedule at one instant and admit every due slot idempotently.
- `__DueScheduledSlots`, `__ParseCronExpression`, `__CronMatchesWallClock`, `__WallClockInZone`,
  `__IsValidCronExpression`, `__IsValidTimezone` — the cron + timezone evaluation primitives.
- `__ScheduledRunIdempotencyKey` — the deterministic per-slot key.
- `__NextBackoffDelayMs` — deterministic retry-delay hint for a transient admission failure.
- `_CreateScheduleTicker`, `ScheduleTicker` — the ready-to-run coordinator that snapshots enabled
  schedules, checks active scheduled runs, delegates every due slot through shared admission, then
  makes a version-fenced cursor update.
- `PrismaScheduleTickerUnitOfWork` — the only scheduling implementation that owns the root Prisma
  client and opens transactions; callers receive capability repositories, never Prisma.
- `ScheduleTickStatuses`, `ScheduleInvalidReasons`, `ScheduledSlotOutcomes`,
  `ScheduleCursorAdvanceOutcomes` — stable scheduler-owned branch values. The overlap vocabulary is
  imported from the schedule authority as `AgentScheduleOverlapPolicies`.
- Types: `AgentServiceSchedule`, `ScheduleTickerUnitOfWork`, `ScheduleTickerResult`,
  `ScheduleTickDependencies`, `ScheduleTickResult`, `ScheduledSlotOutcome`,
  `ActiveScheduledRunLookup`, `RetryBackoffPolicy`, `ScheduleClock`, `CronExpression`,
  `WallClock`, `DueScheduledSlotsOptions`.

## Boundary

The application creates the unit of work and periodically invokes the exported ticker. The unit of
work alone owns the root Prisma client and creates three narrow transaction-scoped repositories:
enabled schedule snapshots, active scheduled-run lookup, and cursor CAS. Each database operation is
short and finishes before run admission begins; a database transaction never spans external
admission. `ManagedRunAdmissionPort` remains the sole run-creation boundary. This package never
touches Kubernetes or Obot, and it never executes shell or agent business logic.

## Dependency direction

Tagged `scope:agent-services` (it shares the managed-agent capability with the definition plane): it
may depend only on `scope:agent-services`, `scope:agents`, `scope:audit`, `scope:authorization`,
`scope:auth`, `scope:grants`, `scope:membership`, and `scope:shared`. It imports
`ManagedRunAdmissionPort` from the sibling
`agent-services` package and never the reverse, so there is no cycle.

## Data & persistence

The `AgentServiceSchedule` model it evaluates is owned by the sibling `agent-services` package in
`apps/opencrane/prisma/schema/agent-services.prisma`. The ticker reads enabled schedules and advances
`lastScheduledAt` only through slots that the admission authority accepted, overlap skipped, or
permanently denied; transient failures retain the previous cursor for retry.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [agent-services](../../agent-services/main/README.md) · [skills](../../skills/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
