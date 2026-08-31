# ADR 0015 — Central durable authorization authority

- **Status:** Accepted
- **Date:** 2026-08-29
- **Related:** [ADR 0003](0003-cilium-spiffe-identity-substrate.md) ·
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md) ·
  [ADR 0011](0011-single-run-input-and-artifact-read-authorities.md) ·
  [ADR 0013](0013-workflow-control-plane.md) ·
  [ADR 0014](0014-claimed-warm-runtime-pool.md)

## Context

OpenCrane already stores Principals, Groups, capability catalogues, grants, approvals,
ToolInvocation admissions, and audit decisions in PostgreSQL. Adoption is incomplete. MCP access uses the generic
grant evaluator, while several product routes still rely on an organisation-admin session flag,
resource ownership, silo membership, or domain-specific access rules. Skills, agents, artifacts,
providers, conversations, and other product resources therefore do not all answer permission
questions through the same authority.

That fragmentation is unsafe for agents. A managed agent is a durable Principal and can act without
a human request being open. A personal agent acts for its human but must also stay inside its
published revision and run limits. A Kubernetes Pod proves the workload identity assigned to it; it
does not prove the product permission that caused the work to exist. These actors need one decision
model without making runtimes, controllers, or network policy into additional policy engines.

An authorization check also cannot be separated from the protected database write. If a remote
service returns allow before the domain starts its transaction, a grant can be revoked or a resource
can change between the decision and the write. OpenCrane must be able to order those events in the
same database transaction and retain the decision evidence that committed with the action.

## Decision

OpenCrane has one logical `AuthorizationAuthority`. It is an in-process application port in the
authorization capability, backed by the silo PostgreSQL database. A domain UnitOfWork opens the
transaction and supplies an authority adapter bound to that transaction.

```text
authenticated Principal
        │
domain UnitOfWork opens database transaction
        │
        ├── load current membership and resource eligibility
        ├── ask AuthorizationAuthority for the typed action
        ├── write the protected change or admitted effect
        └── append decision evidence or a one-use effect admission
                    │
                 COMMIT
```

The transaction commits all four outcomes together or rolls them all back. Read-only catalogue
filtering may use the same policy in a short read transaction and may decide a batch without writing
one receipt per item. A mutation, approval, delegation, or external effect must create the durable
admission or decision evidence required by its risk class.

The authority owns:

- the typed product resource and action catalogue;
- Principal and direct Group subject resolution from stored identity facts;
- allow and deny precedence, grant validity, expiry, and revocation;
- the intersection of current grants with agent-revision and run limits;
- safe decision explanations;
- transaction-bound external-effect admission; and
- durable authorization decisions and one-use effect admissions.

Domain owners provide trusted resource facts. Authorization does not decide whether an MCP revision
is Ready, a skill revision is Published, an artifact revision passed its scan, or a model definition
is Active. The domain checks that lifecycle in the same transaction and the authority treats the
result as eligibility input. Lifecycle eligibility can narrow an allow decision but never grant
permission by itself.

### Actors

- A human uses its durable local `Principal` and direct stored Group grants.
- A personal agent uses the human Principal's current grants intersected with the approved agent
  revision and frozen run limits.
- A managed agent uses its own `AgentService` Principal grants intersected with its revision and run
  limits. The human who invokes, edits, schedules, or administers the managed agent needs a separate
  permission for that management action.
- A workload uses no product grants. TokenReview proves its ServiceAccount and Pod identity, then
  the server binds that identity to one admitted action and assignment.

OAuth DPoP proves possession of the private key bound to a presented token. It is an identity and
transport replay defence, not a product policy engine. Where a boundary uses DPoP, the verified
Principal still reaches this authority for the product decision, while `ToolInvocation` or the
domain admission record owns one-use effect replay state.

Frozen run inputs are ceilings, not permanent grants. Current membership, grant revocation, resource
revocation, and cancellation are checked before the next external effect. A historical action stays
in the audit log; revocation does not rewrite it.

### Resources and actions

The authority uses a reviewed resource vocabulary rather than domain-defined strings. It includes
stable resources and immutable revision resources where later revisions must not inherit permission
accidentally:

```text
agent-service       agent-service-collection                 agent-revision
skill               skill-revision
mcp-server          mcp-server-revision  mcp-tool-revision  model-definition
artifact            artifact-revision    dataset            memory-scope
persona             persona-collection   conversation       channel-target
provider-connection
schedule            budget
```

Action families include discover, read, create, edit, use, assign, review, publish, invoke,
schedule, delegate, share, send, revoke, retire, delete, forget, manage, and administer. Each
resource-action pair declares whether it needs transaction-bound decision evidence or a one-use
external-effect admission. The owning domain separately decides whether human approval is required.

### Governed packages, artifacts, and images

MCP and skills share authorization and package-governance concepts without becoming one persistence
aggregate.

```text
governed package revision
        │
        ├── MCP server revision
        │     └── imported OCI image digest
        │
        └── Skill revision
              ├── instruction bundle in ArtifactStore
              ├── sandboxed code bundle + future OpenCrane runner image
              └── future containerized code skill + governed OCI image digest
```

An `ArtifactRevision` identifies immutable content bytes in ArtifactStore. An OCI image identifies a
runnable manifest, configuration, and filesystem layers in an OCI registry. A container is one
running instance of an image. The current `SkillRevision` is artifact-backed. The retired
tool-runner control plane is removed, so neither sandboxed nor containerized code-skill execution is
claimed as implemented by this decision.

OpenCrane distinguishes governed product images from platform images:

- a governed image is user- or operator-supplied product content, such as an MCP server or a future
  containerized code skill;
- a platform image implements OpenCrane, such as the agent runtime, MCP companion, skill authoring
  validator, scanner, preprocessor, controller, or future skill execution runner.

Registry storage and image digests are supply-chain facts, not permission grants. Authorization
targets the product resource and immutable revision. External-effect admission then binds the
allowed revision to its content address or OCI digest, the fixed execution profile, and one workload
assignment. Workers receive no general registry credential and cannot select another image.

## Alternatives considered

- **Deploy authorization as a separate service** — rejected for this architecture. A network check
  cannot join the domain's PostgreSQL transaction and creates a decision-to-write race or a second
  distributed transaction protocol. A future deployment split needs a new ADR that preserves one
  policy implementation and atomic admission.
- **Keep organisation-admin and ownership shortcuts beside grants** — rejected. Two policy systems
  can disagree and make human and agent behaviour differ. Ordinary owner and administrator powers
  become bootstrap-managed grants; ownership and silo remain resource facts, not sufficient
  permission.
- **Use Kubernetes RBAC or NetworkPolicy as product authorization** — rejected. They limit
  infrastructure reachability and cannot express current Principal, Group, revision, approval, or
  product-resource policy.
- **Create one universal package table for MCP and skills** — rejected as unnecessary for
  authorization. Shared resource/action types and OCI admission can be reused while each domain
  retains its lifecycle, metadata, protocol, and execution records.
- **Make every skill an OCI image** — rejected. Instruction skills need no separate container. The
  target sandboxed-code path can use a reviewed OpenCrane runner with an immutable artifact bundle;
  a governed skill image is reserved for code that genuinely needs its own runtime.

## Consequences

- Product middleware authenticates callers but cannot make the final product permission decision.
- Every protected domain transaction calls the same authority port and deletes the role, ownership,
  visibility, or package-specific policy path it replaces.
- Authorization remains dependency-light and cannot import agents, MCP, skills, artifacts,
  conversations, providers, or workload implementations.
- Domain packages may depend on the authorization port and supply lifecycle facts through narrow
  inputs.
- Agent runtimes, controllers, companions, and workers stay free of grant evaluation and database
  access.
- The public API and UI expose server-computed permitted actions and safe explanations instead of
  deriving capability from `isOrgAdmin`.
- CI keeps an enforcement inventory and rejects new product authorization bypasses.
- The callerless DPoP capability verifier, runtime authority, effective-access facade, and
  `ActionExecutionReceipt` model are removed. Live workload key registration remains identity
  evidence; `ToolInvocation` and domain admission records own one-use effect replay state.
- No compatibility shim, dual evaluation, or delayed cleanup is retained during adoption.
