# MCP gateway

OpenCrane keeps **MCP registration, authorisation, approvals and receipts** in the control plane
while Obot keeps custody of integration credentials. After durable admission and any required
approval, a server worker calls Obot; the isolated model runtime never receives provider access.

> See also: [Governed agent runtime](/integrators/agent-runtime) (external-action flow),
> [Control access](/guide/permissions) (grants), and
> [Identity and runtime authentication](/security/identity) (run proof).

## Responsibility split

| Component | Responsibility |
|---|---|
| OpenCrane MCP registry | Definitions, revisions and organisation-scoped publication |
| Custody provisioning route | Hands an integration credential to Obot; stores only the opaque reference |
| Run input compiler | Freezes only the model-visible allowed tool revisions for one run |
| Durable action authority | Saves the request before work, gates approval and owns recovery |
| Server action worker | Resolves current Obot addressing and executes one fenced provider operation |
| Runtime Job | Emits an action candidate and later consumes the exact saved server result |

An MCP registration does not by itself grant an agent access. The acting subject and agent
service must both pass membership and grant resolution before the tool revision enters the
run's compiled capability set.

## Control plane and data plane

Two planes with different traffic:

- **Control plane (server → Obot, service credential):** custody provisioning creates and
  configures an MCP server in Obot; the credential travels write-only and only here.
- **Action execution (server → Obot):** after durable admission and approval, a server worker
  resolves the current assignment and performs the MCP call. Provider addressing and credentials
  never enter the runtime pod.

## Invocation flow

```text
runtime emits external_action candidate
       │
       ▼
OpenCrane verifies run proof and arguments digest
       │
       ▼
save one Preparing tool invocation ──► durable approval request when required
       │
       ▼
owner approves ──► invocation becomes Ready
       │
       ▼
server worker claims and calls Obot once
       │
       ▼
server stores the exact success or safe failure result
       │
       ▼
one saved-result delivery resumes the runtime
```

OpenCrane saves the invocation before any external I/O. Preparation may retry at most three times
within five minutes, and only before provider dispatch starts. Once dispatch may have started, the
worker uses the adapter's trusted recovery strategy; if it cannot prove the outcome, the run enters
a visible, cancellable recovery state instead of repeating the action.

::: info Current transport status
The custody and server-side invocation transports are composed when the deployment mounts
the Obot service credential (`mcpGateway.serviceTokenExistingSecret`); without it the server
composes fail-closed unavailable adapters. Qualification against a live Obot deployment remains
gated on issue #337, so the exact Obot response shapes are validated defensively rather than
contract-pinned.
:::

::: warning
Integration credentials never leave Obot, and the runtime receives no Obot key, address or provider
secret. Approvals, allow-lists, provider calls and saved results stay server-side; a model response
cannot widen its own reach.
:::

## Failure posture

- An unregistered or ungranted tool revision is denied.
- An arguments-digest mismatch is denied.
- A required approval pauses the run at the durable reservation.
- Without the Obot mount, custody provisioning and server-side invocation fail closed and an approved
  integration tool ends in a typed loop error.
- A runtime-authored `tool.completed` report is refused; only the server worker can complete an action.
- An unknown provider outcome is never retried blindly; the run visibly needs recovery.
- A late result from a cancelled or replaced attempt is not accepted.

Source: [`libs/backend/server/infra/obot-custody`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/infra/obot-custody/README.md)
and [`libs/backend/agents/execution/protocol`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/protocol/README.md).
