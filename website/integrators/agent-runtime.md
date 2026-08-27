# Governed agent runtime

OpenCrane executes each accepted **AgentRun attempt** in a fresh, bounded Kubernetes `Job`.
The control plane remains authoritative for identity, inputs, events, approvals and outcomes.

> See also: [Run limits and cost](/guide/budgets) (per-run technical ceilings and spending budgets),
> [Agent delegation](/guide/child-runs) (governed child-run limits),
> [OCI MCP runtime](/integrators/oci-mcp-runtime) (tool execution),
> [Memory write, manage and read](/integrators/retrieval-memory) (memory and return boundaries), and
> [Identity and runtime authentication](/security/identity) (workload proof).

## One runtime, two admission authorities

Personal and managed runs share every mechanism below, but never share an admission path.
Personal admission derives its `AgentService` from the caller's own participant-bound
`agent_session` conversation and verifies one signed personal membership assertion; managed
admission derives the `agent-service:<id>` principal,
verifies its current Ed25519-signed fleet membership, and intersects the active revision's exact
knowledge/tool attachments with effective grants. A personal run's frozen input always names an
approved `PersonaRevision`; a managed run's never does, because its published revision is already
complete. Neither path can produce the other's identity or inherit its grants — see
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
  │  create and release the exact suspended Job
  ▼
agent-runtime Job
  │  outbound authenticated stream
  ▼
ordered events · action candidates · terminal outcome
```

The controller is the only process allowed to project authorised run attempts into the
runtime namespace. It reports the Kubernetes-issued Job and first-Pod identities to the
control plane before the runtime can bootstrap.

## Authority boundaries

| Component | Owns | Does not own |
|---|---|---|
| OpenCrane server | run admission, frozen input, ordered events, approvals, cancellation, durable outcome | Kubernetes workload mutation |
| Agent controller | exact Job creation, one conditional release, first-Pod registration | user, revision, grants, budget or run state |
| Agent runtime | bounded model loop and normalised candidates | tools, provider credentials, durable transcript or policy |

The runtime has no listener, Service, Ingress, database client or persistent user volume.
It uses capped ephemeral scratch space and initiates its connection to the control plane.

## External actions

A model tool call becomes an `external_action` candidate. The control plane re-derives its
arguments digest, checks the frozen grants and approval policy, and issues one durable claim for the
appropriate executor class. Only the authorised result is returned to the paused loop.

::: warning
Do not add a direct tool executor or durable store to the runtime image. That would create a
second policy, credential or transcript authority.
:::

## Source

- [`apps/agent-runtime`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-runtime/README.md)
- [`apps/agent-controller`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-controller/README.md)
- [`apps/opencrane/prisma/schema/runs.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/runs.prisma)
