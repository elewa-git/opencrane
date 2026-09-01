# Governed agent runtime

OpenCrane executes each accepted **AgentRun attempt** in a claimed, one-use Kubernetes Pod from a
small warm pool. The control plane remains authoritative for identity, inputs, events, approvals
and outcomes; a pre-started Pod has no attempt authority until the durable claim succeeds.

::: info
🔶 The 0.11.0 `ExecutionSubject` contract is present, but target run admission stays unavailable
until the app composes checked Kurrent AgentIdentity and conversation-computer evidence.
:::

> See also: [Run limits and cost](/guide/budgets) (per-run technical ceilings and spending budgets),
> [Agent delegation](/guide/child-runs) (governed child-run limits),
> [OCI MCP runtime](/integrators/oci-mcp-runtime) (tool execution),
> [Central authorization authority](/integrators/authorization-authority) (product action admission),
> [Memory write, manage and read](/integrators/retrieval-memory) (memory and return boundaries), and
> [Identity and runtime authentication](/security/identity) (workload proof).

## One runtime, two admission authorities

Personal and managed runs share every mechanism below, but never share an admission path.
Each path resolves an AgentIdentity and current Principal, verifies its membership and capability
evidence, and binds the result with the conversation computer's active lease in one
`ExecutionSubject`. The browser or scheduler remains requester provenance, not execution
authority. A personal run's frozen input always names an approved `PersonaRevision`; a managed
run's never does, because its published revision is already complete. Neither path can produce the
other's identity or inherit its grants — see
[Architecture](/advanced/architecture#personal-and-managed-are-separate-authorities-not-a-flag).

## Per-run safety contract

The active immutable agent revision supplies three positive technical ceilings: model turns, total
tokens and elapsed time. Admission refuses a missing or malformed ceiling, derives the wall-clock
deadline from trusted server time and freezes the resulting policy into the run snapshot. A caller
cannot provide a larger value or extend the deadline.

For a newly onboarded personal assistant, the approved defaults are 64 model turns, 256,000 total
tokens and 60 minutes. These values apply to one agent run. They do not apply to ordinary Direct or
Group messages that do not invoke an agent, and they are separate from account or organisation
spending budgets.

Because the ceilings are part of the revision's digested content, changing one creates a new
revision. That preserves which limits governed an older run instead of rewriting its history.

::: warning Qualification requirement
The control plane validates and freezes all three ceilings. Before relying on them operationally,
qualify that the target runtime release produces the expected terminal outcome for the turn, token
and elapsed-time boundaries. The remaining enforcement work is tracked in
[GitHub issue #651](https://github.com/elewa-git/opencrane/issues/651).
:::

## Runtime sequence

```text
caller
  │  request
  ▼
OpenCrane control plane
  │  admit AgentRun + freeze RunInputSnapshot
  ▼
agent-controller
  │  reserve exact warm Pod + activate fixed network profile
  ▼
claimed agent-runtime Pod
  │  prove readiness + bind one-use proof identity
  │  receive scoped model key in process memory
  │  open outbound authenticated stream
  ▼
ordered events · action candidates · terminal outcome
  │
  ▼
controller deletes exact Pod UID · Deployment restores a fresh spare
```

The controller is the only process allowed to project authorised run attempts into the
runtime namespace. The database reservation names the exact Deployment UID, Pod UID, attempt and
fixed personal or managed profile before the controller changes any Kubernetes label. The
controller then proves that the same Pod is reachable through the selected profile. The Pod presents
its rotating projected token and fresh public proof key to the private binding endpoint; OpenCrane
derives its trusted Pod identity through TokenReview and returns the attempt-scoped model key only
after the binding commits.

The claimed Pod is never returned to the generic pool. Completion, cancellation, failure or runtime
replacement saves a deletion command for the exact Pod UID. The controller verifies its owner chain,
deletes it with a UID precondition, and waits for its absence; Kubernetes creates a fresh generic
spare from the Helm-owned Deployment.

## Authority boundaries

| Component | Owns | Does not own |
|---|---|---|
| OpenCrane server | run admission, frozen input, ordered events, approvals, cancellation, durable outcome | Kubernetes workload mutation |
| Agent controller | exact warm-Pod reservation projection, fixed-profile activation, readiness proof and UID-fenced deletion | user, revision, grants, budget or run state |
| Agent runtime | Pod-local readiness and one-use binding, outbound command stream, bounded model loop and normalised candidates | tools, provider credentials, durable transcript or policy |

The runtime exposes only a Pod-local readiness listener used during the claim. It has no
Service, Ingress, database client, Kubernetes RBAC or persistent user volume. It uses capped
ephemeral scratch space and initiates the binding request and command stream to the control plane.

::: warning Warm-path qualification
The source contract requires a complete warm claim in under one second and a ready replacement after
a pool miss in under five seconds. Tests enforce those event-time bounds, but each target cluster
must still qualify the complete database, controller, network-policy and runtime hand-off before the
figures are treated as an operational guarantee.
:::

## External actions

A model tool call becomes an `external_action` candidate. The control plane re-derives its arguments
digest, treats the frozen run contract as a ceiling, rechecks current membership, grants, lifecycle,
cancellation and approval policy, and issues one durable claim for the appropriate executor class.
Only the authorised result is returned to the paused loop.

::: warning
Do not add a direct tool executor or durable store to the runtime image. That would create a
second policy, credential or transcript authority.
:::

## Source

- [`apps/agent-runtime`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-runtime/README.md)
- [`apps/agent-controller`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-controller/README.md)
- [`libs/backend/agents/execution/runs/controller`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/runs/controller/README.md)
- [`libs/backend/agents/runtime/controller`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/runtime/controller/README.md)
- [`apps/opencrane/prisma/schema/runs.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/runs.prisma)
