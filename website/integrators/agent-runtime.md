# Governed agent runtime

OpenCrane executes each accepted **AgentRun attempt** in a fresh, bounded Kubernetes `Job`.
The control plane remains authoritative for identity, inputs, events, approvals and outcomes.

> See also: [Agent delegation](/guide/child-runs) (governed child-run limits),
> [MCP gateway](/integrators/mcp-gateway) (tool custody), and
> [Identity and runtime authentication](/security/identity) (workload proof).

## One runtime, two admission authorities

Personal and managed runs share every mechanism below, but never share an admission path.
Personal admission derives its `AgentService` from the caller's own thread and verifies one signed
personal membership assertion; managed admission derives the `agent-service:<id>` principal,
verifies its current Ed25519-signed fleet membership, and intersects the active revision's exact
knowledge/tool attachments with effective grants. A personal run's frozen input always names an
approved `PersonaRevision`; a managed run's never does, because its published revision is already
complete. Neither path can produce the other's identity or inherit its grants — see
[Architecture](/advanced/architecture#personal-and-managed-are-separate-authorities-not-a-flag).

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
arguments digest, checks the frozen grants and approval policy, and executes the action through
the appropriate custody boundary. Only the authorised result is returned to the paused loop.

::: warning
Do not add a direct tool executor or durable store to the runtime image. That would create a
second policy, credential or transcript authority.
:::

## Source

- [`apps/agent-runtime`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-runtime/README.md)
- [`apps/agent-controller`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-controller/README.md)
- [`apps/opencrane/prisma/schema/runs.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/runs.prisma)
