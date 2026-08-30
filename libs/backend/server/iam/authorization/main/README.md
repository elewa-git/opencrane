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
share one commit boundary. The authority is deliberately an in-process port, not a separate network
service. External work cannot run inside that open transaction, so effectful actions first create a
one-use durable command bound to the Principal, resource revision, arguments digest, and workload
profile.

Personal agents act through their human Principal, limited by their admitted agent revision and run
ceiling. Managed agents act through their own `AgentService` Principal. A human's permission to
invoke or administer a managed agent is separate from the grants that let the agent perform work.

Attaching a Group subtree is stricter than acting on the Group itself. A command that requests
`Descendants` coverage fails closed unless a winning grant also carries `Descendants`; an exact-only
grant cannot silently become authority over child Groups. Commands that request exact coverage keep
the ordinary exact boundary-matching rules.

## Public surface

- `AuthorizationAuthority` decides one typed action or batch-filters a lifecycle-eligible catalogue.
- `PrismaAuthorizationAuthority` binds that port to the caller's existing Prisma transaction.
- The transaction-internal authorization grant repository loads the Principal, verifies current
  external membership, expands direct Group subjects, loads matching grants, and resolves stored
  boundary context.
- The managed-grant repository narrowly reconciles one manager's live grants against immutable
  catalogue references.
- `__DecideDeferredToolRequest`, `__OpenDeferredToolApproval`,
  `PrismaToolInvocationUnitOfWork`, and their lifecycle contracts own durable human approval and
  provider-effect recovery for tool calls.
- `__CancelPendingRunApprovalAuthority` lets the runs domain close pending approval and unclaimed
  tool work inside the runs domain's cancellation transaction.

## Boundary

The authority decides product permission; it does not authenticate a browser or Pod, own another
domain's lifecycle, execute a provider call, or grant Kubernetes access. The caller derives the silo
and Principal from verified identity, loads the target from trusted domain data, and treats the
frozen run snapshot only as a ceiling. Current membership, grants, cancellation, and resource
eligibility are rechecked before each new external effect.

Catalogue reads may be batch-filtered without one receipt per visible row. A mutation must record
decision evidence in the same transaction. An external effect must use the durable `ToolInvocation`
or another typed one-use command; workers cannot list grants or choose a different target.

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
