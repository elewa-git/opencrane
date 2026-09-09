# OCI MCP runtime

OpenCrane executes each admitted **Model Context Protocol (MCP) server** from its immutable OCI
image in a one-use Kubernetes Job. Registration, grants, approvals and durable results remain in
the control plane; an uploaded image never runs inside the generic agent runtime.

> See also: [Conversation computers](/integrators/agent-runtime) (compute and approval boundaries),
> [Governed packages and container images](/integrators/governed-packages) (artifact and image model),
> [Central authorization authority](/integrators/authorization-authority) (shared MCP and skill permission model),
> [Manage tools with MCP](/guide/tools) (administrator workflow), and
> [Identity and runtime authentication](/security/identity) (workload proof).

## Responsibility split

| Component | Responsibility |
|---|---|
| OpenCrane MCP registry | Definitions, immutable image digests and organisation-scoped publication |
| Run input compiler | Freezes the allowed tool revisions for one run |
| Durable invocation authority | Saves the request, gates approval and issues one executor claim |
| Agent controller | Creates the exact suspended Job, records its UID and releases it |
| OpenCrane companion | Claims one command, checks MCP `2026-07-28` and reports one fenced result |
| Uploaded MCP server | Handles Pod-local discovery or one allowed tool call without an OpenCrane token |

An MCP registration does not grant an agent access. The acting subject and agent service must pass
membership and grant resolution before a tool revision enters the run's frozen capability set.

::: info Conversation integration status
The current follow-up source connects an accepted private conversation proposal to the existing
executor. That handoff still awaits fresh PostgreSQL CI and live qualification. The conversation
model loop does not yet request tools, resume from results or publish durable tool progress.
See [development status](/guide/status) for the source and live checkpoints.
:::

## Admission is not execution permission

```text
ArtifactRevision with OCI Image Layout ZIP
        │ validate layout and import checked bytes
        ▼
OciImageValidation ──► immutable registry reference
        │ explicit promotion
        ▼
McpServerRevision ──► discovery freezes MCP 2026-07-28 tool schemas
        │ central Use/Invoke decision
        ▼
ToolInvocation ──► one exact MCP executor assignment
```

Each record answers a different question. `OciImageValidation` proves which bytes were accepted and
imported. `McpServerRevision` and `McpToolRevision` provide governed product identities.
`AuthorizationAuthority` proves that the Principal may use the selected tool, and `ToolInvocation`
owns the one-use call and its recovery state. A valid digest cannot substitute for a grant, and a
grant cannot make an unready revision executable.

## Execution flow

```text
server admits a permitted tool call
       │
       ▼
OpenCrane validates assignment, current authorization, arguments and approval
       │
       ▼
save invocation + readiness + executor work in one transaction
       │
       ▼
agent-controller creates suspended two-container Job
       │  save Job UID before release
       ▼
companion rechecks current authority and claims one bounded command
       │
       ▼
fixed companion calls uploaded MCP server over loopback
       │
       ▼
companion reports one checked result through the active fence
       │
       ▼
OpenCrane saves the result; conversation resumption remains pending
```

For a conversation proposal, one PostgreSQL transaction checks the frozen tool and arguments,
rechecks current access, prepares the invocation and saves its executor work. An exact retry
recovers that work after it progresses; changed arguments cannot replace it. The private route
returns a proposal receipt, without returning a tool result.

Before dispatch, the current conversation guard supplies the earliest original run deadline,
computer lease expiry and frozen/current membership-trust expiry. The invocation claim also respects
the configured claim duration. The MCP write must match that claim's exact fence and revision;
PostgreSQL caps its expiry to the saved invocation deadline and refuses an elapsed claim. The
companion receives the same persisted deadline, so delayed writes cannot renew authority. Public
task-owned calls and discovery keep their existing claim-duration policy.

The uploaded server receives no projected OpenCrane token, Service, ingress, registry credential or
Kubernetes mutation permission. The fixed companion owns the short-lived audience-bound token and
accepts only MCP `2026-07-28`. Malformed, expired, oversized, redirected or timed-out exchanges fail
closed.

::: warning
A generic runtime Pod cannot execute an uploaded image. Keep OCI MCP work in the dedicated executor
Job class so the admitted digest, Kubernetes UID, Pod UID and durable claim remain one authority.
:::

## Failure posture

- An unregistered, unpublished or ungranted tool revision is denied.
- An arguments-digest mismatch or expired claim is denied.
- A required approval pauses before an executor claim is issued.
- Cancellation closes the saved command before the companion calls the uploaded server.
- A late or mismatched Pod report cannot complete the invocation.
- Provider errors remain checked failures; the companion never invents an empty success.

Source: [`libs/backend/agents/runtime/mcp-executor`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/runtime/mcp-executor/README.md)
and [`apps/mcp-executor`](https://github.com/elewa-git/opencrane/blob/main/apps/mcp-executor/README.md).
