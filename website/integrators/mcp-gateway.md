# MCP gateway

OpenCrane keeps **MCP registration, authorisation, approvals and receipts** in the control plane
while Obot keeps custody of integration credentials and serves the invocation data plane: after an
approval, the runtime calls Obot's MCP proxy directly with a short-lived, attempt-scoped key, so
tool payloads never transit the OpenCrane server.

> See also: [Governed agent runtime](/integrators/agent-runtime) (external-action flow),
> [Control access](/guide/permissions) (grants), and
> [Identity and runtime authentication](/security/identity) (run proof).

## Responsibility split

| Component | Responsibility |
|---|---|
| OpenCrane MCP registry | Definitions, revisions and organisation-scoped publication |
| Custody provisioning route | Hands an integration credential to Obot; stores only the opaque reference |
| Run input compiler | Freezes the allowed tool revisions and their Obot MCP server addressing for one run |
| OpenCrane action executor | Re-derives arguments, reserves the invocation and gates the approval |
| Attempt key mint | Issues one Obot API key per run attempt, scoped to the assigned MCP server ids |
| Runtime Job | Emits an action candidate, executes the approved call against Obot, reports a digest |

An MCP registration does not by itself grant an agent access. The acting subject and agent
service must both pass membership and grant resolution before the tool revision enters the
run's compiled capability set.

## Control plane and data plane

Two planes with different traffic:

- **Control plane (server → Obot, service credential):** custody provisioning creates and
  configures an MCP server in Obot (the credential travels write-only and only here), and each
  claimed run attempt mints one Obot API key scoped to the exact MCP server ids of the run's
  integration assignments, expiring with the assignment lease. The key rides the claim into a
  per-attempt Kubernetes Secret; it is never persisted or logged.
- **Data plane (runtime → Obot, attempt key):** after an approval the runtime performs the MCP
  `initialize` + `tools/call` exchange against `/mcp-connect/<serverId>/mcp` itself. The compiled
  tool definition carries the `obotMcpServerId` as non-secret addressing; the allow-list plus the
  key's server scoping remain the authority.

## Invocation flow

```text
runtime emits external_action candidate
       │
       ▼
OpenCrane verifies run proof and arguments digest
       │
       ▼
reserve one tool invocation ──► durable approval request
       │
       ▼
owner approves ──► resume names the approved toolInvocationId
       │
       ▼
runtime calls Obot MCP proxy directly (attempt-scoped key)
       │
       ▼
runtime reports tool.completed { resultDigest }
       │
       ▼
reservation marked Succeeded with the digest-only receipt
```

OpenCrane reserves the invocation before any external I/O, and the durable receipt records only a
SHA-256 digest of the canonical result — never the tool content. A duplicate completion for the
same invocation is refused rather than rewriting the receipt.

::: info Current transport status
The custody, attempt-key and direct-invocation transports are composed when the deployment mounts
the Obot service credential (`mcpGateway.serviceTokenExistingSecret`); without it the server
composes fail-closed unavailable adapters. Qualification against a live Obot deployment remains
gated on issue #337, so the exact Obot response shapes are validated defensively rather than
contract-pinned.
:::

::: warning
Integration credentials never leave Obot. The runtime holds only an attempt-scoped Obot key —
scoped to the exact MCP server ids of its integration assignments and expiring with the assignment
lease — never the Obot service credential or any provider secret. Approvals, allow-lists and
digest-only receipts stay server-side; a model response cannot widen its own reach.
:::

## Failure posture

- An unregistered or ungranted tool revision is denied.
- An arguments-digest mismatch is denied.
- A required approval pauses the run at the durable reservation.
- Without the Obot mount, custody provisioning and key minting fail closed and an approved
  integration tool ends in a typed loop error.
- An unknown or duplicate `tool.completed` report is refused; receipts are digest-only.
- A late result from a cancelled or replaced attempt is not accepted.

Source: [`libs/backend/_server/obot-custody`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/_server/obot-custody/README.md)
and [`libs/backend/agents/execution/protocol`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/protocol/README.md).
