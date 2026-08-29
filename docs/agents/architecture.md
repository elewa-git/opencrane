# Architecture and identity

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Read this file before changing identity, authorization, runtime trust, or organisation boundaries.
The whole deployment view is in [`cluster-architecture.md`](./cluster-architecture.md).

## Product authority

OpenCrane owns the durable product record:

```text
Conversation -> ordered ConversationTimelineEntry
     |
     +-> direct/group Message (no run)
     +-> agent_session -> AgentRun -> ordered RunEvent
                              |
                              +-> immutable RunInputSnapshot
                              +-> approvals and tool invocations
                              +-> workload assignment and cleanup
                              +-> governed artifact references
```

PostgreSQL is authoritative for agents, revisions, runs, conversations, approvals, memberships,
grants, budgets, and audit evidence. Artifact bytes live behind `ArtifactStore`; database records
own their identity, version, authorization, and lineage.

A claimed runtime Pod is an attempt-scoped worker. It receives a frozen snapshot, reports candidates
and events, and owns no durable product state. A generic warm Pod has no attempt authority until the
database reserves it and the controller activates its fixed profile. Kubernetes objects project an
already-authorised attempt; they do not authorise a run by existing.

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

## Central authorization authority

Every product permission check goes through one `AuthorizationAuthority` contract. It is an
in-process application port, not a separately deployed service: the product domain opens the
database transaction and constructs the Prisma-backed authority over that same transaction client.

```text
domain UnitOfWork
      |
      +-- load current identity, membership, grants, and boundary facts
      +-- decide typed resource + action through AuthorizationAuthority
      +-- apply the domain's lifecycle rule
      +-- write the protected change and required evidence
      |
    commit or roll back together
```

This **transaction-bound** shape closes the check-then-write gap. A network authorization service
cannot share the product transaction without introducing a distributed-transaction protocol, so do
not add remote policy calls or a second domain-specific policy engine.

The actor model is explicit:

- a human acts as their local `Principal`, with direct and inherited Group grants;
- a personal agent acts through that human Principal, narrowed by its agent revision and run ceiling;
- a managed agent acts as its own `AgentService` Principal, narrowed by its revision and run ceiling;
- permission to invoke or administer a managed agent is separate from the agent's execution grants;
- a controller or worker consumes one exact admitted assignment and cannot reinterpret grants.

The shared product catalogue maps each supported `resource kind × action` to an evidence class.
Reads may be batch-filtered in a short transaction. Mutations commit decision evidence beside the
protected write. External effects first commit a one-use command bound to the Principal, resource
revision, arguments digest, approval, and workload profile; the worker executes only that command.

A frozen run snapshot is a maximum, not a durable grant. Recheck current membership, grants,
cancellation, and domain lifecycle eligibility before each new external effect. Preserve historical
evidence for effects that already completed.

## Runtime boundary

Each accepted run attempt has one fenced reservation for an exact Pod from the fixed personal or
managed warm pool. The agent controller is the sole mutator of those Pods. Runtime service accounts
have no Kubernetes API permission, and every used Pod is deleted instead of returning to the pool.

Runtime commands and output candidates must bind the current run, attempt, assignment, sequence,
expiry, and proof key. Cancellation closes command, approval, and output admission before workload
cleanup completes.

## External actions

Model, tool, memory, and artifact access passes through OpenCrane-owned ports:

- LiteLLM provides model access under attempt-scoped policy;
- admitted immutable OCI images execute Model Context Protocol calls in isolated executor Jobs;
- memory access uses explicit organisation and subject scopes;
- sandboxed tools run in isolated Jobs; and
- artifact bytes use short-lived, purpose-bound leases.

A runtime never receives provider master keys, integration credentials, storage master keys, or
direct database access.

## Artifacts and OCI images

An `ArtifactRevision` is immutable content in ArtifactStore. An OCI image is a runnable manifest,
configuration, and filesystem-layer graph identified by a registry digest. A container is one
runtime instance of an OCI image. Do not collapse these into one database aggregate merely because
OCI supply-chain language also calls images artifacts.

MCP admission starts from an OCI Image Layout ZIP held by an `ArtifactRevision`, validates and
imports it, then records the immutable registry reference on `McpServerRevision`. A current
`SkillRevision` instead points to an immutable artifact bundle. Reviewed instructions are loaded as
content; sandboxed Python is loaded by the fixed OpenCrane tool-runner image. A future
containerized-code skill class may point at its own governed OCI digest, but it must not turn the
current artifact-backed skill record into an image record.

Platform images such as the agent runtime, MCP companion, tool runner, scanner, and controllers
belong to an OpenCrane release. Governed images such as uploaded MCP servers belong to product
revisions. Operators may store both classes in OCI registries, but release authorization and product
authorization remain separate.

## Change checklist

For any identity or authorization change, verify:

- the principal and organisation are derived from trusted evidence;
- the requested action and resource are bound before access;
- revocation and cancellation close future use;
- replay, ambiguity, and missing state fail closed;
- runtime and browser clients cannot mint their own authority; and
- tests include a negative case for each trust-boundary mismatch; and
- no protected route, controller, worker, or catalogue bypasses `AuthorizationAuthority` with a
  role flag, owner-only check, silo-wide list, or domain-specific grant evaluator.
