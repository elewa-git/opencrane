# @opencrane/backend/server/iam/authorization — the central product permission authority

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › authorization

## What it owns

This package is the server-side **authorization authority**: the one application port through which
OpenCrane product domains ask whether a Principal may perform a typed action on a resource. A
Principal is the durable identity of a person or managed agent. The authority combines current
membership, direct and inherited Group grants, exact resource boundaries, and the shared product
capability catalogue.

The domain that owns a protected change also owns the database transaction. It creates a
`PrismaAuthorizationAuthority` over that same Prisma transaction, asks for a decision, applies its
domain lifecycle rules, and writes the change plus required evidence before commit.

```
 product domain UnitOfWork
        │ opens one database transaction
        ▼
 membership + grants + boundary facts
        │
        ▼
 ┌──────────────────────────────────────┐
 │ authorization authority  ◄── HERE    │  typed allow / deny + evidence class
 └──────────────────────────────────────┘
        │
        ├── database change + decision evidence ──► commit together
        └── one-use admitted external effect ─────► worker executes later
```

**In this flow:** [membership](../../membership/main/README.md) establishes current organisation
membership, [audit](../../audit/main/README.md) retains decision evidence, and the owning product
domain supplies lifecycle facts and performs the protected change.

Transaction binding prevents a check-then-write gap: authorization reads and the protected write
share one Serializable commit boundary. The shared Prisma transaction runner repeats the complete
operation at most three times, and only after a P2034 proves PostgreSQL rolled back every write in
the losing attempt; each retry constructs a fresh transaction-scoped authority. The authority is
deliberately an in-process port, not a separate network service. External work cannot run inside
that open transaction, so effectful actions first create a one-use durable command bound to the
Principal, resource revision, arguments digest, and workload profile.

Personal agents act through their human Principal, limited by their admitted agent revision and run
ceiling. Managed agents act through their own `AgentService` Principal. A human's permission to
invoke or administer a managed agent is separate from the grants that let the agent perform work.

Attaching a Group subtree is stricter than acting on the Group itself. A command that requests
`Descendants` coverage fails closed unless a winning grant also carries `Descendants`; an exact-only
grant cannot silently become authority over child Groups. Commands that request exact coverage keep
the ordinary exact boundary-matching rules.

## Public surface

- `AuthorizationAuthority` decides one typed action or batch-filters a lifecycle-eligible catalogue.
- `decidePrincipal` checks current eligibility across stored personal and Group boundaries without
  recording evidence. An allowed result cannot replace `admitPrincipal` for a concrete mutation or
  effect. Catalogue filtering still accepts Read-class rules only, and admission rejects Read rules.
- `PrismaAuthorizationAuthority` binds that port to the caller's existing Prisma transaction.
- `___RunSerializableAuthorizationTransaction` gives database-only product UnitOfWorks one bounded
  P2034-only retry policy for authorization reads, protected writes, and audit evidence. Its
  callback must not contain Kubernetes, provider, filesystem, or other effects that can survive a
  database rollback.
- The transaction-internal authorization grant repository loads the Principal, verifies current
  external membership, expands direct Group subjects, loads matching grants, and resolves stored
  boundary context.
- The managed-grant repository narrowly reconciles one manager's live grants against immutable
  catalogue references. New grants become valid at the caller's trusted operation time, which also
  timestamps revocations. This lets onboarding create grants and admit publication with the same
  clock even when PostgreSQL starts the transaction later. Callers supply server-derived time,
  never a browser timestamp. Reconciliation leaves existing activation times unchanged; current
  membership, future validity, expiry, revocation and competing deny grants still govern decisions.
- Exact resource retirement rechecks organisation administration and soft-revokes every active
  grant on the retiring coordinates inside the owning product transaction.
- `PrismaManagedShareRevocationRepository` soft-revokes the exact manager-owned grant linked from
  an explicit resource-share relation; it cannot create, list, or revoke arbitrary grants.
- `__DecideDeferredToolRequest`, `__OpenDeferredToolApproval`, `__OpenDeferredToolApprovalInTransaction`,
  `__CreatePrismaMcpToolInvocationParticipantFactory`, and their lifecycle contracts own durable human approval and
  provider-effect recovery for tool calls. A deferred approval opens only when the run and admitted
  invocation carry the same immutable execution subject, including the active conversation-computer
  lease id and generation; released or replaced leases fail closed.
- `__AdmitPreparingToolInvocationInTransaction` and `__PrepareToolInvocationInTransaction` let the
  conversation owner save and prepare a permitted call in the transaction that queues its MCP
  executor. The existing lifecycle still enforces approval requirements and observed revisions.
- Run-owned MCP dispatch requires the injected current-authority check before a provider claim.
  Its returned absolute deadline caps the claim to the original run budget, current computer lease
  and frozen/current membership trust, within the configured claim duration. MCP stores the same
  cap before returning a command to the executor; neither retries nor a delayed write renew it.
  A known denial closes only the observed Ready revision and saves one failed result delivery
  after the lifecycle fence accepts it. Durable KurrentDB tool history remains pending.
  A read outage propagates so the transaction rolls back.
  Task-owned calls retain their distinct task projection. The unused external-action transaction
  wrapper is removed; the MCP runtime owns production dispatch.
- `__CancelPendingRunApprovalAuthority` lets the runs domain close pending approval and unclaimed
  tool work inside the runs domain's cancellation transaction.

Run-owned tool result reads use `__ReadRunToolResultInTransaction`. The caller supplies all saved
run, attempt, computer, command, public invocation and fingerprint coordinates. IAM checks the
current run and the full immutable terminal payload and digest, then returns the existing invocation
record for a current-authority check in the same transaction. Pending or inconsistent work exposes
no result content. `__ConsumeRunToolResultInTransaction` acknowledges only that exact payload;
the conversation owner must first prove the saved second-model-request reservation and current
permission. An exact replay preserves its first acknowledgement time, and consumed results remain
readable for restart verification. Neither API grants model dispatch or starts a provider call.

`__ReadRunToolProgressInTransaction` reads the latest invocation phase for an already authorized
run, scoped to silo, run and current attempt. The personal status owner must check ownership and
current Read permission in that same transaction first. This projection does not consume a result,
record a new decision or grant any authority; database errors remain errors rather than empty work.

## Boundary

Source is grouped into `authority/`, `grants/`, `approvals/`, and `tool-invocations/`. Each keeps
its contracts and tests beside its owner, with database adapters in `persistence/`. The public
entrypoint remains `src/index.ts`; consumers never import these internal folders.
Run-result reads, delivery acknowledgement, and invocation row mapping belong to `tool-invocations/`.
The row mapper translates stored values without importing Prisma; its database callers live in
`tool-invocations/persistence/`.

Approval opening, reviewer decisions, deadline expiry, reviewer grants, and run-batch completion
have separate command owners. They receive the caller's transaction and preserve the same atomic
approval/invocation/run changes. The split introduces no independent commit, policy authority,
retry loop, or network call.

Tool approval saves the display-safe argument projection with the participant request. The body
also freezes the admitted tool name, its provider-authored description, and the operator-authored
server name before the participant decides. If the schema marks any proposed value as sensitive,
the body contains no arguments and IAM accepts denial only.

The authority decides product permission; it does not authenticate a browser or Pod, own another
domain's lifecycle, execute a provider call, or grant Kubernetes access. The caller derives the silo
and Principal from verified identity, loads the target from trusted domain data, and treats the
frozen run snapshot only as a ceiling. Current membership, grants, cancellation, and resource
eligibility are rechecked before each new external effect.

Catalogue reads may be batch-filtered without one receipt per visible row. A mutation must record
decision evidence in the same transaction. An external effect must use the durable `ToolInvocation`
or another typed one-use command; workers cannot list grants or choose a different target.

Workload effect admission requires the identity verified by the transport owner. The authority
rejects missing or inconsistent Pod coordinates before grant reads, binds that identity and any
saved run coordinates into its evidence digest, and records them in the same transaction. The
Principal still determines whose permissions are checked; the audit actor names the requesting Pod.

## Dependency direction

Tagged `scope:authorization`: it may depend only on `scope:audit`, `scope:auth`,
`scope:authorization`, and `scope:shared` packages — never on apps or sibling product domains.

## Data & persistence

The package owns `AuthorizationGrant`, `CapabilityCatalogRevision`, `ApprovalRequest`,
`ToolInvocation`, and `ToolResultDelivery` in the authorization schema. Product-domain tables remain
owned by their domains. Every authorization lookup is silo-bound, and grant replacement is scoped to
one manager and resource so it cannot revoke another manager's evidence.

`ToolInvocation` is the durable authority for an external tool call. Preparation and approval may
retry only within their declared budgets; an ambiguous provider result follows the adapter's frozen
idempotency or reconciliation mode and never becomes an unrecorded automatic retry.
Every run-owned invocation stores the complete structured admission evidence alongside the existing
`approvalRequired` and approval relation. A caller-owned MCP task stores the Principal, actor class,
tool/action coordinate, decision digest, and a digest that binds that evidence to the task, tool
revision, and arguments; it does not invent AgentRun membership or workload-assignment fields.
Database constraints reject either owner's partial evidence and changes to evidence after insertion.

## See also

- Parent index: [iam](../../README.md)
- Policy model: [models/authorization](../../../../../models/authorization/main/README.md)
- Siblings: [membership](../../membership/main/README.md) · [identity](../../identity/main/README.md) · [grants](../../grants/main/README.md) · [audit](../../audit/main/README.md)
