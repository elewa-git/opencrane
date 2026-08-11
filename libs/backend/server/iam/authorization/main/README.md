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
transaction to cancel every still-pending approval and close provider-free invocation work. It is deliberately
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
Before accepting a decision, the authority recomputes the frozen schema digest and the actor-safe
projection. A schema that contains a secret is denial-only: a forged approval body cannot turn that
request into provider dispatch, while an authenticated denial still closes it normally.
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
- `__CancelPendingRunApprovalAuthority` — closes pending approvals and only provider-free or
  unclaimed invocations for an exact run attempt on a caller-owned database transaction. Active
  provider claims remain fenced until their definite result or recovery decision becomes durable.
- `ApprovalRequest` remains internal tool audit evidence. Browser reads, live overlays, and decisions
  use the conversation-scoped elicitation authority; reviewed arguments, proof data, policy digests,
  and resume material remain internal here.
- `__OpenDeferredToolApproval` — atomically links an awaiting ToolInvocation to its approval, then
  recovers an ambiguous commit or terminalises the invocation so it cannot be replayed.
- `__ProjectDeferredToolApproval`, `__ValidateDeferredToolArguments` — derive the secret-safe actor
  projection and validate a complete approved replacement against the frozen reviewed tool schema.
- Deferred-approval contracts are split by authority: `DeferredToolApprovalLifecycle*` owns the
  exhaustive run-state table; `DeferredToolDecision*` owns decision and expiry commands;
  `DeferredToolApprovalOpen*` owns invocation-linked opening and ambiguous-commit recovery; and the
  schema helper owns the pre-redacted internal projection stored with audit evidence.
- `__DigestCanonicalJson` — an authorization-domain wrapper over the shared environment-neutral
  canonical JSON hash, preserving one SHA-256 implementation across server and browser consumers.
- `PrismaRuntimeAuthorityRepository`, `PrismaAuthorizationGrantRepository` — the database-backed
  stores for accepted proofs/receipts and for candidate grants.
- `PrismaToolInvocationUnitOfWork`, the narrow
  `__AdmitPreparingToolInvocationInTransaction` helper, and
  `__PlanToolInvocationLifecycle` — atomically turn an admitted runtime candidate into durable work,
  then apply one exhaustive State × Event policy to every preparation, approval, fenced provider
  claim, reconciliation, terminal result, cancellation, and recovery-required transition without
  changing the separate proof/JTI receipt lifecycle. Every public UnitOfWork completion includes its
  canonical lifecycle event in the same transaction; its transaction repository remains
  package-private. Runs owns the injected run-state recovery port; authorization never writes
  `AgentRun.state` directly.
- `ToolInvocationAdmissionOutcomes`, `ToolInvocationClaimOutcomes`, `ToolResultDeliveryOutcomes`,
  and `DeferredToolDecisionOutcomes` are stable transaction result vocabularies shared by the
  authorization owner and its protocol consumers.
- `PrismaToolInvocationElicitationRepository` — binds the narrow ToolInvocation read,
  approve/reject, safe failure-delivery, and active dispatch-claim checks to an existing elicitation
  transaction without exporting the full persistence repository.
- `TOOL_INVOCATION_PREPARATION_POLICY` — the one frozen provider-free retry policy consumed by
  admission, scheduling, lifecycle decisions, cancellation, and durable recovery events.
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
`ActionExecutionReceipt` in `apps/opencrane/prisma/schema/authorization.prisma`. It also owns
`ToolInvocation` and the one-to-one `ToolResultDelivery` outbox. `ToolInvocation` is the durable work
authority for runtime tool calls; `ActionExecutionReceipt` remains the separate proof/JTI-bound
capability-action receipt. A tool-backed
`ApprovalRequest` retains the frozen reviewed candidate and schema as server-only authority,
precomputes a separate actor-safe projection, and stores the exact normalized final arguments and
digest only when approved. The target still retains the old nullable resume-hash column until its
separate destructive removal is explicitly approved, but this lifecycle neither mints nor consumes it.

### External-action recovery lifecycle

Candidate acceptance and a `Preparing` invocation commit together. Preparation may retry at most
three times and only during the first five minutes; it cannot contact a provider. Once the trusted
adapter's dispatch method begins, a missing acknowledgement is ambiguous rather than retryable.

| Durable state | Accepted event | Next state or result |
|---|---|---|
| `Preparing` | prepared | `AwaitingApproval` or `Ready` |
| `Preparing` | provider-free preparation failed | retry within the three-in-five-minute budget, otherwise `Failed` |
| `AwaitingApproval` | approved | `Ready` |
| `AwaitingApproval` | denied, expired, or cancelled | `Failed` plus one result delivery |
| `Ready` | fenced dispatch claim | `Claimed` |
| `Claimed` | definite success or rejection | terminal state plus one result delivery |
| `Claimed` | ambiguous result | keyed redispatch, `Reconciling`, or `RecoveryRequired` from the frozen adapter mode |
| `Reconciling` | confirmed outcome | terminal state plus one result delivery |
| `Reconciling` | absent or inconclusive | `Ready` or `RecoveryRequired` |
| `RecoveryRequired` | cancellation | `Failed`; no implicit retry or result exists before resolution |

The current Obot integration declares manual recovery: it provides neither provider idempotency nor
trusted readback. An ambiguous Obot result therefore pauses the run visibly and remains cancellable;
it is never dispatched again automatically. Terminal invocation state and its delivery intent share
one transaction. Runtime command persistence consumes that intent, and reconnect replays the stored
command body byte for byte.

### Deferred approval lifecycle

The approval unit of work owns the run pause and approval rows in one transaction. Decision kind is
a separate result strategy: approval carries complete validated replacement arguments, while denial
and expiry carry an explicit refusal and never execute the awaiting invocation.

| Run state | Event | Pending after event | Action | Atomic owner |
|---|---|---:|---|---|
| `Running` | open | 0 before create | move to `WaitingForInput`, then create | approval-open unit of work |
| `WaitingForInput` | open | one or more | add to the current batch | approval-open unit of work |
| `WaitingForInput` | decision or expiry | one or more | remain waiting | approval-decision or expiry unit of work |
| `WaitingForInput` | decision or expiry | 0 | move to `Running`; make the batch resumable | approval-decision or expiry unit of work |
| `Running` or `WaitingForInput` | cancellation | any | cancel pending rows without resume authority | caller-owned cancellation transaction |
| any other state | open, decision, or expiry | any | reject | exhaustive lifecycle state registry |

Multiple requests may share one pause. The dispatcher consumes all resolved rows in deterministic
order, and a later pause creates a later `resume_attempt`; an earlier resume never strands a later
approval batch. Inbox, detail, conversation overlays, and the decision transaction all recheck the
current active local organisation membership, so a surviving browser session grants no authority
after the Fleet projection suspends the member.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [membership](../../membership/main/README.md) · [identity](../../identity/main/README.md) · [grants](../../grants/main/README.md) · [audit](../../audit/main/README.md)
