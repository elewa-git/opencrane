# @opencrane/backend/agents/execution/admission — trusted run admission composition

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › admission

## What it owns

This package is the internal entry into the shared execution flow for both an agent-session message
and a managed agent. The conversation authority or managed invocation has already established the
request shape before it arrives here. Admission composes one canonical execution subject, immutable input
assembly, the durable run repository, and one app-owned process-local capacity boundary.

```
 conversation message / managed trigger .... requester provenance + canonical subject authority
                 │
                 ▼
 ┌────────────────────────────────────────┐
 │ execution/admission  ◄── HERE           │ one shared capacity grant at process/silo/service
 │ issue + recheck subject, inputs + runs  │ then assemble and persist one snapshot
 └────────────────────────────────────────┘
                 │  admitted run id / stable denial
                 ▼
 execution/runs ........ durable run + snapshot + workflow task
```

**In this flow:** app composition supplies an `ExecutionSubjectAdmissionAuthority` that issues and
then transaction-rechecks one canonical AgentIdentity, Principal, capability, and computer-lease
subject · [inputs](../../inputs/main/README.md) assembles the immutable snapshot ·
[runs](../../runs/main/README.md) persists the durable run authority.

One shared gate serves every personal and managed admission path in the server process. That is
load-bearing: separate entrypoint gates could each consume the same database budget. Admission is
granted only when the process, silo, and exact agent service all have capacity. A missing, stale,
overloaded, or inconsistent input produces a denial before unbounded persistence work begins.

Personal admission has two bounded stages. A synthetic per-silo preflight lane first limits its
participant-conversation read before interactive traffic can touch PostgreSQL. Once that lane has
derived the real personal AgentService, the normal process/silo/service gate issues the subject,
checks the duplicate key against its AgentIdentity and Principal, and limits the final transaction
that rechecks all mutable authority. A caller-supplied transaction callback
then persists the canonical input message beside the run, immutable snapshot, and Absurd workflow
task in that same commit. The first lane does not grant product authority; it is overload
protection for the read path.

Message idempotency keys are public conversation-local coordinates. Before personal admission reads
or writes the silo-global `AgentRun` keyspace, it hashes the conversation id and public key with a
domain separator. The same key therefore deduplicates exact retries inside one conversation without
conflicting with an independent message in another conversation; managed-run keys keep their existing
server-owned semantics. If a different key races to start a second foreground run in the same agent
session, the final durable fence returns `active_run` after revalidating that conversation instead of
misreporting the partial-unique-index conflict as a persistence outage. If the database reports the
unique loss before the final reader can classify it, the still-bounded personal recovery reader
returns `active_run` only after a fresh participant, lifecycle, mode, and non-terminal-run check;
unclassified failures remain `persistence_unavailable`.

## Public surface

- `__CreateManagedRunAdmissionPort(prisma, workflow, capacityGate, executionSubjectAuthority)`
  composes managed admission with a required app-owned canonical subject authority.
- `__CreatePersonalRunAdmissionPort(prisma, workflow, capacityGate, executionSubjectAuthority)`
  composes personal admission with the same authority. It derives an AgentService from a
  participant-owned open agent session; browser credential facts remain requester provenance.
- `_CreateRunAdmissionCapacityGate(policy)` creates the one hierarchical process/silo/service gate
  injected into both personal and managed ports.
- `PersonalRunAdmissionPort` and `RunAdmissionCapacityGate` are the only cross-package port types;
  repository and preflight types remain internal implementation detail.
- `__ReadRunAdmissionConcurrencyPolicy(environment?)` reads and validates the two bounded capacity
  settings. The optional map exists for deterministic configuration tests; production uses
  `process.env`.

## Boundary

Consumed by the OpenCrane server composition root, which creates one shared gate and passes it to
the conversation authority, managed run-now path, and scheduler. This package has no public browser
router or OpenAPI path: interactive execution begins only at
`POST /api/v1/me/conversations/:conversationId/messages`. It does not authenticate HTTP requests,
authorise agent service publication, schedule work, activate Kubernetes Pods, or execute a run. It
accepts server-owned requester provenance but never treats it as execution authority. The required
subject authority issues the target subject before idempotency and rechecks it in the durable
admission transaction; this package delegates snapshot and run rules to their owning packages.

The in-memory gates are overload protection, not product authority. Silo identity and admission
eligibility are still re-derived and persisted by the workflow packages. A process
restart may clear waiting work but cannot admit an unauthorized run or rewrite a committed one.

## Dependency direction

Tagged `scope:execution-admission`: it may depend only on `scope:execution-admission`,
`scope:execution-inputs`, `scope:execution-runs`, `scope:agent-services`, and `scope:shared` — never
on apps, transport adapters, runtime infrastructure, or unrelated backend domains.

## Runtime & config

- `AGENT_RUN_ADMISSION_MAX_CONCURRENT` defaults to `2` and must be an integer from `1` through `2`.
- `AGENT_RUN_ADMISSION_MAX_QUEUED` defaults to `10` and must be an integer from `0` through `100`.

Malformed values fail server startup. The global process ceiling is twice the per-service policy,
while each silo and exact agent service retain the configured limits.

## See also

- Parent index: [execution](../../README.md)
- Siblings: [inputs](../../inputs/main/README.md) · [runs](../../runs/main/README.md) ·
  [protocol](../../protocol/README.md)
