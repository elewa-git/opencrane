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
  `PrismaSelfDeferredToolApprovalListRepository` — the owner-only pending approval inbox, decision
  surface, and their persistence adapters. The router derives the person and silo from the signed-in
  browser session; the list omits arguments, proof data, policy digests, and resume credentials.
- `__DigestCanonicalJson` — a stable hash of a request used across the checks above.
- `PrismaRuntimeAuthorityRepository`, `PrismaAuthorizationGrantRepository` — the database-backed
  stores for accepted proofs/receipts and for candidate grants.
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
cannot name a run, choose an executor result, or provide a resume token. It may only approve or deny
the pending action attached to its own subject in its own silo. An expired request is terminalised
before any decision is recorded; a decision whose run, workload, or proof is stale becomes a typed
conflict rather than a silently cancelled approval; and a successful approval wakes the existing
runtime command path exactly once.

## Dependency direction

Tagged `scope:authorization`: it may depend only on `scope:audit` (to record decisions) and
`scope:shared` — never on apps or other sibling domains.

## Data & persistence

Owns `AuthorizationGrant`, `CapabilityCatalogRevision`, `ApprovalRequest`, and
`ActionExecutionReceipt` in `apps/opencrane/prisma/schema/authorization.prisma`.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [membership](../../membership/main/README.md) · [identity](../../identity/main/README.md) · [grants](../../grants/main/README.md) · [audit](../../audit/main/README.md)
