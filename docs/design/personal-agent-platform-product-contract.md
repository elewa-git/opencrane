# Personal-agent platform product contract

Status: **accepted**

OpenCrane provides governed personal and managed agents whose inputs, actions, and outcomes remain
explainable and recoverable. This contract describes the durable product behaviour; implementation
status belongs in the code, tests, and release notes.

## Product capabilities

| Capability | Contract |
|------------|----------|
| Organisation identity and membership | Bind OIDC subjects to signed, revisioned organisation membership evidence. Unknown, expired, or unverifiable membership fails closed. |
| Agents and revisions | Keep agent definitions stable and configuration immutable per revision. A run binds one exact revision. |
| Conversations and runs | Provide immutable `agent_session`, `direct`, and `group` modes with a canonical timeline. Agent sessions add governed serial runs; ordinary direct and group messages create no runs. |
| Run input | Persist one immutable `RunInputSnapshot` before dispatch. It binds identity, conversation context, persona, memory references, tools, model route, and budget. |
| Persona and preferences | Store reviewable, versioned persona and preference facts. Changes affect later snapshots only. |
| Memory | Apply explicit dataset identity, scope, provenance, and authorization to durable personal and organisation memory. |
| Artifacts | Store immutable bytes and revision metadata with ownership, hashes, media type, provenance, and run links. |
| Models and budgets | Govern provider credentials, public model aliases, routes, quotas, and usage through control-plane policy. |
| Integrations and tools | Bind immutable tool revisions to assignments and grants. Execute approved external actions server-side. |
| Skills | Publish immutable, reviewable skill revisions and bind runs to exact assigned revisions. |
| Schedules | Provide pause, resume, approval, retry, and idempotent managed-run intent. |
| Audit and operations | Retain authorization decisions, security events, structured telemetry, backup evidence, and operator controls. |

## Authorization

OpenCrane evaluates all applicable direct and group grants:

1. collect the grants applicable to the subject, resource, and requested action;
2. select the highest priority;
3. when priorities are equal, `Deny` wins; and
4. apply a timestamp tie-break only where the contract explicitly defines one.

Projects are a containment dimension independent of departments. Membership of one does not imply
membership of the other. Dataset membership and other read projections are derived from grants and
never become authorization authorities themselves.

## Identity failure behaviour

A membership assertion contains the organisation, subject binding, monotonically increasing
revision, issuer, issued-at and expiry times, and signature. OpenCrane accepts only the newest
verified revision it has observed within its bounded freshness window.

An unknown subject, missing binding, invalid signature, stale revision, or unavailable identity
authority cannot authorize sign-in, run admission, grant expansion, administration, or credential
renewal. An outage must not turn an unknown member into an active member.

## Conversation, run, and event contract

`Conversation` is the durable aggregate. Its immutable mode is `agent_session`, `direct`, or `group`,
and one database-owned sequence orders its messages and safe run-backed projections. Direct and
ordinary group messages create no run. An agent session conditionally owns serial
`AgentRun -> ordered RunEvent` hierarchies; before an attempt starts, OpenCrane persists the run and
its exact immutable input snapshot. Events are accepted only through the control-plane admission
path, use deterministic sequence ordering, and preserve one terminal outcome.

Runtime assignments and commands are fenced by attempt. Retry creates a new attempt; it does not
rewrite the evidence of an earlier one. Cancellation, approvals, usage, external-action results,
and failures become canonical events before clients rely on them.

Conversation close is monotonic; participant archive and unread position remain separate visibility
coordinates. An authorized group `@agent` message atomically creates one child agent session and its
first run. [ADR 0012](../adr/0012-conversation-modes-and-agent-thread-authority.md) records the full
mode, parent/child, delivery, and non-disclosure contract.

## External-action contract

The runtime may propose a tool call but cannot authorize or execute it. OpenCrane resolves the exact
tool revision and then checks the snapshot, grant, approval, budget, and idempotency state. Only a
server-owned executor receives the scoped credential and performs the action.

If policy, approval, credential, budget, or audit persistence is unavailable, execution fails closed.
A result that cannot be persisted is not reported as a durable success.

## Persona onboarding

The first personal-agent session requires an approved persona revision. The onboarding interview
captures role, tone and language, answer structure, challenge preference, initiative level, risk and
approval boundaries, working habits, and memory boundaries. The user may review, edit, replace, or
restart the result.

The runtime receives only the approved revision through the compiled input. It does not own or
mutate durable persona files.

## Storage and retention

Canonical transcripts, persona revisions, memory references, artifacts, runs, and audit evidence
remain until an explicit authorized deletion and reference-safe purge completes. Durable stores use
mounted persistent storage with backup and restore coverage.

Runtime workspaces are non-authoritative scratch storage. Pod replacement, scale-to-zero, or lease
expiry may clear them without losing product state.

## Acceptance

An implemented capability must demonstrate:

- tests against the current capability and authorization contracts;
- fail-closed identity, policy, credential, and persistence behaviour;
- silo isolation and scoped external I/O;
- immutable run input and ordered event evidence where execution is involved;
- structured logs and traces for external I/O;
- backup and restore coverage for owned durable state; and
- independent review with no unresolved Critical or High security finding.

Live qualification validates behaviour against real dependencies and infrastructure. It is not an
authority boundary and does not determine which product paths remain supported.

> See also: [platform architecture](personal-agent-platform-architecture.md),
> [ADR 0008](../adr/0008-target-agent-contracts-and-workload-identity.md), and
> [ADR 0011](../adr/0011-single-run-input-and-artifact-read-authorities.md), and
> [ADR 0012](../adr/0012-conversation-modes-and-agent-thread-authority.md).
