# @opencrane/backend/server/iam/authorization — the allow-or-deny decision point

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › authorization

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers two questions: **who is making this request, and are they allowed to do this?** IAM tracks
the people, the automated agents working on their behalf, and the rules for what each may touch.

Authorization is the final yes-or-no step. Whenever an agent tries to do something that changes real
data — save a file, call an outside tool, read from memory — the request stops here first, and this
package decides whether to allow it. By this point IAM has already worked out *who* the agent is:
another package has confirmed the person is still a signed member of the fleet (the set of customer
workspaces managed together), and the agent arrives
carrying two things — a signed statement of what it was granted, and a short-lived proof that it
really is the workload it claims to be. This package checks both are genuine and still valid, then
answers allow or deny with a plain reason.

```
 an agent wants to act   (write a file · call a tool · read memory)
        │  presents: what it was granted + the proof it is that workload
        ▼
  membership ............. is this person still a signed member of the fleet?
        │  trusted / denied
        ▼
 ┌───────────────────────────────┐
 │   authorization   ◄── HERE     │  grants line up? proof genuine? not replayed?
 └───────────────────────────────┘
        │  allow (run once) / deny (+ plain reason)  →  audit
        ▼
  the action runs, or is refused
```

**In this flow:** [membership](../../membership/main/README.md) · [audit](../../audit/main/README.md) · the runtime action path *(the caller that carries out the effect)*

To decide, it lines up three things: the effective access the agent was granted, the proof the agent
presents that it is that exact workload, and what the system can independently see about the agent
right now. Effective access is the **intersection** of two sets of grants — what the person is
allowed *and* what the agent's assigned role is allowed — so an agent can never do more than its
human. Current signed membership is a mandatory first gate and is never inferred from grants. Every
proof it accepts is remembered by its unique id, so the same proof can never be replayed to run an
action twice. When the run owner begins cancellation, it calls this package inside the same database
transaction to cancel every still-pending approval and clear its resume token. It is deliberately
strict: anything missing, altered, or out of date is a "no". A mistake here can only ever refuse a
legitimate request — never hand out access it should not.

Tool approval is an interrupt in that same authority, not a second execution path. Its identifier is
the interrupt identifier. The opener freezes the exact candidate arguments and reviewed compiled
tool schema before the actor sees the request. Actor reads select only a pre-redacted argument
projection plus a decision schema derived from that frozen tool schema; schema-marked secret values,
policy evidence, and resume material never cross the API. Approval requires one complete argument
value, validates it server-side against the frozen schema, then atomically records the normalized
value and digest. Denial records no arguments, but it does create one single-use refusal marker so
the runtime receives the decision instead of silently losing the pending tool call.
Managed-service execution cannot silently substitute its `agent-service:*` execution identity for a
human approver. An approval-required managed action fails closed at opening until the admitted run
carries a concrete, currently authorized human approval subject.

## Public surface

- `__ResolveEffectiveAccess` — computes the capabilities allowed to *both* the person and the agent,
  gated on current signed membership; returns only the intersection.
- `__VerifyCapabilityProof`, `__ComputeEs256JwkThumbprint`, `__NormalizeDpopTargetUri` — verify the
  cryptographic proof an agent presents that it is that workload and is calling this exact endpoint.
- `__ConsumeRuntimeBootstrap` — validates and atomically spends a one-time startup token that binds a
  run to its pod and attempt, and accepts only the `opencrane-agent-runtime` projected-token audience,
  so it cannot be reused or confused with a service-specific action token.
- `__ExecuteCapabilityAction` — verifies the proof, reserves its unique id durably, then runs the
  effect exactly once (or returns the earlier result on an allowed idempotent retry).
- `__CancelPendingRunApprovalAuthority` — closes only pending approvals for an exact run attempt on
  a caller-owned database transaction, clearing every late-resume token atomically with cancellation.
- `__CreateDeferredToolApprovalRouter`, `PrismaDeferredToolApprovalDecisionRepository`,
  `PrismaSelfDeferredToolApprovalListRepository` — the owner-only approval inbox, interrupt detail,
  decision surface, and persistence adapters. The router derives the person and silo from the
  signed-in browser session; actor reads select only pre-redacted arguments and the derived response
  schema, never raw reviewed or final arguments, proof data, policy digests, or resume material.
- `_CreateDeferredToolApprovalRouter` — the ready-to-mount Prisma composition that maps the shared
  authenticated request principal into the approval caller and owns the adapters and clock.
- `__OpenDeferredToolApproval` — atomically links a reserved external action to its approval, then
  recovers an ambiguous commit or terminalises the reservation so it cannot be replayed.
- `__ProjectDeferredToolApproval`, `__ValidateDeferredToolArguments` — derive the secret-safe actor
  projection and validate a complete approved replacement against the frozen reviewed tool schema.
- `__DigestCanonicalJson` — an authorization-domain wrapper over the shared environment-neutral
  canonical JSON hash, preserving one SHA-256 implementation across server and browser consumers.
- `PrismaRuntimeAuthorityRepository`, `PrismaAuthorizationGrantRepository` — the database-backed
  stores for accepted proofs/receipts and for candidate grants.
- `ShareAuthorizationScopeKinds` — the four domain scope categories that sharing accepts; the
  Prisma adapter translates them explicitly and rejects any unsupported stored category.
- Contract types: `ResolveEffectiveAccessCommand`/`Result`, `AuthorizationGrantRepository`,
  `AuthorizationMembershipAuthority`, `CapabilityActionExecutor`, and their siblings.

## Boundary

Consumed by the runtime action path that carries out an agent's effects. It only decides and records;
it never performs the outside effect itself — the caller supplies the executor. Fail-closed
throughout: an invalid command, denied or stale membership, a proof that does not verify, or a
replayed id all return a denial, never an allow. The personal-runs domain owns run cancellation but
must delegate approval-row cancellation through this package's transaction-level port; it never
writes authorization tables directly.

For a deferred tool action, the API is deliberately narrower than the database record: the browser
cannot name a run, choose an executor result, or provide resume material. It may only deny or approve
with one complete argument value for the pending action attached to its own subject in its own silo.
An expired request is terminalised
before any decision is recorded; a decision whose run, workload, or proof is stale becomes a typed
conflict rather than a silently cancelled approval; and a successful approval wakes the existing
runtime command path exactly once.

## Dependency direction

Tagged `scope:authorization`: it may depend only on `scope:audit` (to record decisions) and
`scope:auth` (to resolve backend-type-free request identity), `scope:authorization`, and
`scope:shared` — never on apps or other sibling domains.

## Data & persistence

`PrismaShareAuthorizationUnitOfWork` binds the candidate-grant reader and
`PrismaShareAuthorizationRepository` to one transaction for each sharing procedure. The repository
owns the narrow catalog-seeding and share-grant persistence seam used by the sharing API. It scopes
every grant lookup, list and revocation to one `siloId`, so
a principal can never discover or revoke a delegation held by another ClusterTenant. The catalog
revision is seeded idempotently; the stored digest, rather than a caller-supplied value, binds later
grant evaluation to the canonical capability list. Share reads select only the fields in the public
repository contract and map the generated Prisma scope enum into the narrower sharing vocabulary;
an unsupported stored scope fails closed rather than being cast into the domain result.

Owns `AuthorizationGrant`, `CapabilityCatalogRevision`, `ApprovalRequest`, and
`ActionExecutionReceipt` in `apps/opencrane/prisma/schema/authorization.prisma`. A tool-backed
`ApprovalRequest` retains the frozen reviewed candidate and schema as server-only authority,
precomputes a separate actor-safe projection, and stores the exact normalized final arguments and
digest only when approved. Its single-use resume hash is consumption evidence, not a generic result
payload or an alternative resume endpoint.

### Deferred approval lifecycle

The approval unit of work owns the run pause and approval rows in one transaction. Decision kind is
a separate result strategy: approval carries complete validated replacement arguments, while denial
and expiry carry an explicit refusal and never execute the reserved action.

| Run state | Event | Pending after event | Action | Atomic owner |
|---|---|---:|---|---|
| `Running` | open | 0 before create | move to `WaitingForApproval`, then create | approval-open unit of work |
| `WaitingForApproval` | open | one or more | add to the current batch | approval-open unit of work |
| `WaitingForApproval` | decision or expiry | one or more | remain waiting | approval-decision or expiry unit of work |
| `WaitingForApproval` | decision or expiry | 0 | move to `Running`; make the batch resumable | approval-decision or expiry unit of work |
| `Running` or `WaitingForApproval` | cancellation | any | cancel pending rows without resume authority | caller-owned cancellation transaction |
| any other state | open, decision, or expiry | any | reject | exhaustive lifecycle state registry |

Multiple requests may share one pause. The dispatcher consumes all resolved rows in deterministic
order, and a later pause creates a later `resume_attempt`; an earlier resume never strands a later
approval batch. Inbox, detail, conversation overlays, and the decision transaction all recheck the
current active local organisation membership, so a surviving browser session grants no authority
after the Fleet projection suspends the member.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [membership](../../membership/main/README.md) · [identity](../../identity/main/README.md) · [grants](../../grants/main/README.md) · [audit](../../audit/main/README.md)
