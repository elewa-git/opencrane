# @opencrane/backend/agents/execution/admission — managed run admission composition

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › admission

## What it owns

This package is the managed-agent entry into the shared execution flow. An authenticated agent
service request has already been authorized before it arrives here. Admission then composes the
current service evidence, immutable input assembly, durable run repository, and process-local
capacity controls into the single `ManagedRunAdmissionPort` used by both run-now requests and the
scheduler.

```
 authorised managed request ........ service coordinates + current evidence
                 │
                 ▼
 ┌────────────────────────────────────────┐
 │ execution/admission  ◄── HERE           │ capacity grant at process/silo/service
 │ compose inputs + runs + evidence        │ then assemble and persist one snapshot
 └────────────────────────────────────────┘
                 │  admitted run id / stable denial
                 ▼
 execution/runs ........ durable run + snapshot + outbox
```

**In this flow:** [agent services](../../../../server/agents/agent-services/main/README.md) supplies
the authorized managed request and evidence · [inputs](../../inputs/main/README.md) assembles the
immutable snapshot · [runs](../../runs/main/README.md) persists the durable run authority

One shared port instance serves every managed admission path in the server process. That is
load-bearing: separate run-now and scheduler gates could each consume the same database budget.
Admission is granted only when the process, silo, and exact agent service all have capacity. A
missing, stale, overloaded, or inconsistent input produces a denial before unbounded persistence
work begins.

## Public surface

- `__CreateManagedRunAdmissionPort(prisma, policy, evidenceAuthority)` composes the production
  managed admission port from the durable repository and current evidence sources.
- `__ReadRunAdmissionConcurrencyPolicy(environment?)` reads and validates the two bounded capacity
  settings. The optional map exists for deterministic configuration tests; production uses
  `process.env`.

## Boundary

Consumed by the OpenCrane server composition root, which creates exactly one port and passes it to
the run-now router and scheduler. This package does not authenticate HTTP requests, authorize agent
service publication, schedule work, dispatch Kubernetes Jobs, or execute a run. It accepts a
service-owned evidence authority and delegates durable snapshot and run rules to their owning
packages.

The in-memory gates are overload protection, not product authority. Silo identity and admission
eligibility are still re-derived and persisted by the durable execution packages. A process
restart may clear waiting work but cannot admit an unauthorized run or rewrite a committed one.

## Dependency direction

Tagged `scope:execution-admission`: it may depend only on `scope:execution-admission`,
`scope:execution-inputs`, `scope:execution-runs`, `scope:agent-services`, and `scope:shared` — never
on apps, transport adapters, runtime Jobs, or unrelated backend domains.

## Runtime & config

- `AGENT_RUN_ADMISSION_MAX_CONCURRENT` defaults to `2` and must be an integer from `1` through `2`.
- `AGENT_RUN_ADMISSION_MAX_QUEUED` defaults to `10` and must be an integer from `0` through `100`.

Malformed values fail server startup. The global process ceiling is twice the per-service policy,
while each silo and exact agent service retain the configured limits.

## See also

- Parent index: [execution](../../README.md)
- Siblings: [inputs](../../inputs/main/README.md) · [runs](../../runs/main/README.md) ·
  [protocol](../../protocol/README.md)
