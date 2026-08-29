# Central authorization authority

OpenCrane makes every **product permission decision** through one durable authorization authority.
The authority covers people, Groups, personal assistants, managed agents, and the product actions
their workloads propose.

> See also: [Silo IAM](/integrators/silo-iam) (membership and grant composition),
> [Governed packages and container images](/integrators/governed-packages) (MCP and skill content),
> [Governed agent runtime](/integrators/agent-runtime) (run and workload boundaries), and
> [Identity and runtime authentication](/security/identity) (proof of caller identity).

## What transaction-bound means

The domain that owns a protected change opens the database transaction. It asks the authorization
authority for a decision inside that transaction, writes the product change, and records the
decision evidence or one-use effect admission before committing.

```text
BEGIN DATABASE TRANSACTION
        │
        ├── load current Principal, membership and grants
        ├── load current resource and lifecycle facts
        ├── decide the typed resource action
        ├── write the protected change
        └── write decision evidence or a one-use effect admission
                    │
                 COMMIT
```

If any step fails, the complete transaction rolls back. This closes the gap in which a grant could
be checked, revoked, and then still used for a later write.

The authority is an in-process application port backed by the silo PostgreSQL database. It is not a
separate network service. A remote check could not participate in the product transaction without a
second distributed-transaction protocol.

## Evidence follows the action

The product catalogue declares the evidence class for every supported resource action. A route does
not choose a cheaper class for itself.

| Evidence class | Used for | Durable result |
|---|---|---|
| Read | Catalogue filtering and non-secret reads | The short transaction returns only entitled rows; it need not append one record per visible item. |
| Decision | Product mutations such as publishing, assigning, sharing, or revoking | The protected change and append-only decision evidence commit together. |
| Effect | Tool calls, sends, model use, and other work outside PostgreSQL | The transaction commits a one-use admitted command; completion or recovery is recorded later. |

This distinction keeps ordinary reads efficient without allowing a mutation or outside effect to
escape durable evidence.

## Who acts

| Actor | Effective permission |
|---|---|
| Human | Current membership and direct stored Group grants |
| Personal agent | Human grants ∩ approved agent revision ∩ frozen run limits |
| Managed agent | AgentService Principal grants ∩ approved revision ∩ frozen run limits |
| Human managing an agent | Separate permission to invoke, edit, schedule, delegate, retire, or administer that AgentService |
| Controller or worker | The exact action already admitted for its verified workload assignment |

A managed agent never borrows the permissions of the person who created it. Likewise, permission to
invoke an agent does not automatically grant the agent access to an MCP tool, skill, dataset, model,
or channel target.

## Decision inputs

```text
current organisation membership
            ∩
live direct stored Group grants
            ∩
agent revision limits, when an agent acts
            ∩
frozen run limits, when a run acts
            ∩
current domain lifecycle eligibility
            ∩
required human approval
            │
            ▼
       allow or deny
```

A frozen run records the maximum authority admitted for that run. It is not a permanent grant.
Membership suspension, grant revocation, cancellation, or resource revocation denies the next
external effect. OpenCrane retains the historical evidence for effects that already completed.

## Product authorization is not workload identity

Authentication proves who is calling. TokenReview proves which Kubernetes ServiceAccount and Pod
made an internal request. NetworkPolicy and Kubernetes RBAC constrain where that workload can
connect and which Kubernetes objects it can touch. None of these grants product permission.

OAuth DPoP, short for **Demonstrating Proof of Possession**, is another identity and transport
proof. A client signs a request with its private key so a stolen bearer token cannot simply be
replayed from another client. DPoP can prove that the request presenter holds the expected key; it
still does not decide whether that Principal may use an MCP tool, skill, artifact, model, or agent.
OpenCrane removed its callerless DPoP capability executor and separate action-receipt table during
this convergence. Live runtime key registration remains workload identity evidence, while
`ToolInvocation` and domain admission records own one-use effect replay state.

```text
OIDC or workload token ──► identity proof
                                 │
PostgreSQL grants and state ─────┼──► product authorization
                                 │
NetworkPolicy and RBAC ──────────┘    infrastructure containment only
```

A runtime, controller, companion, or worker may consume one admitted assignment. It cannot list
grants, reinterpret membership, select a different resource, or mint another admission.

## Reads and external effects

Read-only catalogues can filter many resources in one short transaction. OpenCrane does not need to
write one receipt for every item that a user is allowed to see.

An external effect cannot be performed while a database transaction remains open. OpenCrane instead
creates a one-use admitted command atomically:

```text
database transaction
├── recheck current authorization
├── bind Principal, resource revision and arguments digest
├── bind approval and workload profile when required
└── create one-use admitted command
             │
             ▼
worker executes that command or fails closed
```

Changing the resource, arguments, Principal, assignment, or expiry invalidates the command.
`ToolInvocation` lifecycle and recovery rules replay a proven result or deny an unsafe repeat.

## Domain responsibility

The central authority decides permission. Domain owners still decide whether their resource can be
used:

| Domain fact | Owner |
|---|---|
| MCP revision is Ready and its tool schema is frozen | MCP |
| Skill revision is Published and passed review | Skills |
| Artifact revision is Published and passed its scan | Artifacts |
| Model definition is Active | Model routing |
| Conversation, dataset, schedule, or channel target still exists | Owning domain |

Lifecycle eligibility can narrow an allow decision but never create permission on its own.

## Creation roots and relation projections

A new resource has no identifier yet, so a create route cannot authorize itself against the row it
is about to insert. OpenCrane uses narrow, typed collection roots instead:

```text
active member
    │
	├── agent-service-collection/{silo} · Create
    ├── conversation-collection/{silo} · Create
    ├── artifact-collection/{silo} · Create
    └── persona-collection/{silo} · Create
                    │
                    ▼
       create row and exact grants together
```

Authenticated-principal admission reconciles these four `Create` grants from current active
membership. A suspended or missing membership soft-revokes them before later product admission can
continue. Organisation administration remains a separate grant; collection creation does not imply
`Administer`.

Durable domain relations then project the smallest exact grants that the product can prove:

| Durable fact | Centrally managed projection |
|---|---|
| Current conversation participant | Discover, Read, Edit and Use on that conversation |
| New conversation creator | Delete on that new conversation |
| Artifact owner Principal | Discover, Read, Create and Edit on that artifact |
| Persona creator Principal | Discover, Read, Create, Edit, Use and Delete on that Persona |
| Resource-share owner | Read and Revoke on the share coordinate |
| Current resource-share recipient | Read on the share coordinate |
| Pending tool-approval assignee | Read and Decide on that ApprovalRequest until it becomes terminal |

The relation writer creates or revokes its managed grant in the same database transaction. Upgrade
migration projects only unambiguous existing relations. Historical conversations have no reliable
creator coordinate, so the migration grants nobody `Delete` for them rather than guessing.

::: warning
A registered channel route still needs a durable participant-to-route relation before OpenCrane can
project a route-bound `ChannelTarget` grant. It must not grant every active organisation member
channel access merely because they share a silo.
:::

## Source

- [`libs/models/authorization/main`](https://github.com/elewa-git/opencrane/blob/main/libs/models/authorization/main/README.md)
- [`libs/backend/server/iam/authorization/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/iam/authorization/main/README.md)
- [`docs/adr/0015-central-durable-authorization-authority.md`](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0015-central-durable-authorization-authority.md)
