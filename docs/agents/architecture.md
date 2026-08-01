# Architecture and identity

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Read this file before changing identity, authorization, runtime trust, or organisation boundaries.
The whole deployment view is in [`cluster-architecture.md`](./cluster-architecture.md).

## Product authority

OpenCrane owns the durable product record:

```text
Thread -> AgentRun -> ordered RunEvent
             |
             +-> immutable RunInputSnapshot
             +-> approvals and tool invocations
             +-> workload assignment and cleanup
             +-> governed artifact references
```

PostgreSQL is authoritative for agents, revisions, runs, conversations, approvals, memberships,
grants, budgets, and audit evidence. Artifact bytes live behind `ArtifactStore`; database records
own their identity, version, authorization, and lineage.

A runtime Job is an attempt-scoped worker. It receives a frozen snapshot, reports candidates and
events, and owns no durable product state. Kubernetes objects project an already-authorised attempt;
they do not authorize a run by existing.

## Organisation boundary

A **ClusterTenant** is one customer organisation and its isolated silo. Every durable row,
credential reference, runtime assignment, artifact authorization, and memory scope is bound to that
organisation before use.

Organisation identity comes from trusted installation and verified membership state. Do not accept
an organisation identifier from request payloads, headers, runtime frames, or tool arguments as
authority.

## Identity-first rule

Every trust decision begins with an independently verifiable identity:

1. Browser requests use the verified OpenID Connect session.
2. Internal workloads use a projected service-account token with the exact expected audience.
3. The server binds that identity to the durable assignment and current resource coordinates.
4. Authorization intersects the human or service principal, current grants, resource scope, and
   requested action.
5. Missing, stale, replayed, ambiguous, or mismatched evidence is denied.

Never infer authorization from network location, resource naming, caller-supplied labels, or
possession of a database identifier.

## Runtime boundary

Each accepted run attempt has one isolated Job and one fenced workload assignment. The agent
controller is the sole general creator and releaser of those Jobs. Runtime service accounts have no
Kubernetes mutation rights.

Runtime commands and output candidates must bind the current run, attempt, assignment, sequence,
expiry, and proof key. Cancellation closes command, approval, and output admission before workload
cleanup completes.

## External actions

Model, tool, memory, and artifact access passes through OpenCrane-owned ports:

- LiteLLM provides model access under attempt-scoped policy;
- Obot holds integration credentials and mediates Model Context Protocol calls;
- memory access uses explicit organisation and subject scopes;
- sandboxed tools run in isolated Jobs; and
- artifact bytes use short-lived, purpose-bound leases.

A runtime never receives provider master keys, integration credentials, storage master keys, or
direct database access.

## Change checklist

For any identity or authorization change, verify:

- the principal and organisation are derived from trusted evidence;
- the requested action and resource are bound before access;
- revocation and cancellation close future use;
- replay, ambiguity, and missing state fail closed;
- runtime and browser clients cannot mint their own authority; and
- tests include a negative case for each trust-boundary mismatch.
