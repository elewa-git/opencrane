# OCI MCP runtime

OpenCrane executes each admitted **Model Context Protocol (MCP) server** from its immutable OCI
image in a one-use Kubernetes Job. Registration, grants, approvals and durable results remain in
the control plane; an uploaded image never runs inside the generic agent runtime.

> See also: [Governed agent runtime](/integrators/agent-runtime) (run and approval boundaries),
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
runtime proposes an allowed tool call
       │
       ▼
OpenCrane validates assignment, current authorization, arguments and approval
       │
       ▼
save invocation + issue claim for exact OCI digest
       │
       ▼
agent-controller creates suspended two-container Job
       │  save Job UID before release
       ▼
fixed companion calls uploaded MCP server over loopback
       │
       ▼
companion reports one checked result through the active fence
       │
       ▼
OpenCrane saves the result and resumes the runtime
```

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
