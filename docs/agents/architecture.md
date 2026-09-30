# Architecture and identity

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Read this file before changing identity, authorization, runtime trust, or organisation boundaries.
The whole deployment view is in [`cluster-architecture.md`](./cluster-architecture.md).

## Product authority

OpenCrane owns the durable product record:

```text
Conversation -> ordered KurrentDB conversation-{id} stream (messages, safe logs, membership)
     |
     +-> direct/group entries (no run)
     +-> agent_session -> ConversationComputer -> AgentRun
                              |
                              +-> immutable RunInputSnapshot
                              +-> approvals and tool invocations
                              +-> workload assignment and cleanup
                              +-> governed artifact references
```

The 0.11.0 target records participant-visible conversation, computer, run, effect, artifact, and
receipt history in KurrentDB; PostgreSQL holds rebuildable projections. PostgreSQL remains
authoritative for memberships, grants, approvals, budgets, and transaction-bound decision evidence.
See [ADR 0016](../adr/0016-conversation-history-and-computers.md). Artifact bytes live behind
`ArtifactStore`; database records own their identity, version, authorization, and lineage.

The target computer is the assistant's managed laptop. One pinned, mature harness inside the
conversation-computer Pod owns the live reasoning and tool loop, context and checkpoints, local code
and files, and its persistent browser session. OpenCrane does not schedule each thought or authorize
each local file write. It admits and supervises the session, constrains protected capabilities and
spend, and owns durable user-visible lifecycle and decisions through service boundaries.

`AgentRun` remains a small trusted registration outside the Pod: it binds identity, lineage, payer,
current authorization, assignment, attempt and lifecycle. Approval decisions, external-effect
receipts, published artifacts and memory remain with their existing OpenCrane owners. The Pod has no
full Prisma credentials and cannot turn possession of a run, lease or network address into product
authority. Agent Sandbox starts or replaces the admitted Pod, and the active computer lease fences
its current generation. Kubernetes objects project that admission; their existence does not
authorise a run.

The current source still runs the model/tool continuation loop in the server and exposes only a
bounded workspace and review surface from the Pod. That is implementation evidence, not the target
architecture. Replace the server loop directly only after the computer-owned counterpart proves
restart, Stop and protected-effect behavior; do not retain two active loops or a runtime fallback.
The phased replacement and qualification gates are recorded in the
[computer-owned execution plan](../design/computer-owned-execution-plan.md).

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

Each assistant conversation has one logical computer. Its active lease identifies the admitted
generation; the server admits serial run attempts only after that lease exists. Agent Sandbox owns
Pod lifecycle. Runtime service accounts have no Kubernetes API permission. Cooling and replacement
preserve workspace checkpoints and ordered conversation history, as described in ADR 0016.

KurrentDB carries durable, bidirectional session commands, progress, decisions and results through
the existing authenticated gateway. It is not a per-token or per-step approval protocol and must not
become a second reasoning loop. Runtime commands and output candidates bind the current run,
attempt, assignment, sequence, expiry, and proof key. Cancellation closes new protected effects and
output admission before workload cleanup completes. Root and branch Stop remain race-safe durable
platform commands; timeouts and leases remain lifecycle fences rather than fixed reasoning limits.

## External actions

Model, tool, memory, and artifact access passes through OpenCrane-owned ports:

- the model gateway enforces the selected provider/model policy and reported-spend cutoff without
  exposing provider master keys;
- admitted immutable OCI images execute Model Context Protocol calls in isolated executor Jobs;
- memory access uses explicit organisation and subject scopes;
- artifact bytes use short-lived, purpose-bound leases; and
- external tools apply current connection-and-tool **Allow automatically / Ask / Block** policy and
  preserve one-use effect evidence before a business write.

A runtime never receives provider master keys, integration credentials, storage master keys, or
direct database access. Network reachability is not authorization: every protected service derives
the caller's projected workload identity and rechecks the exact admitted coordinates. Local browser
automation also cannot bypass governed MCP business-write policy through raw browser debugging
access or uncontrolled credentials.

## Artifacts and OCI images

An `ArtifactRevision` is immutable content in ArtifactStore. An OCI image is a runnable manifest,
configuration, and filesystem-layer graph identified by a registry digest. A container is one
runtime instance of an OCI image. Do not collapse these into one database aggregate merely because
OCI supply-chain language also calls images artifacts.

MCP admission starts from an OCI Image Layout ZIP held by an `ArtifactRevision`, validates and
imports it, then records the immutable registry reference on `McpServerRevision`. A current
`SkillRevision` instead points to an immutable artifact bundle. Reviewed instructions are loaded as
content. Sandboxed code-skill execution is not implemented; a future fixed OpenCrane runner may
load a reviewed bundle. A future containerized-code skill class may point at its own governed OCI
digest, but it must not turn the current artifact-backed skill record into an image record.

Platform images such as the agent runtime, MCP companion, scanner, controllers, and a future skill
runner belong to an OpenCrane release. Governed images such as uploaded MCP servers belong to
product revisions. Operators may store both classes in OCI registries, but release authorization
and product authorization remain separate.

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
