# MCP gateway

OpenCrane keeps **MCP registration and authorisation** in the control plane while Obot
provides custody for MCP server connections and execution.

> See also: [Governed agent runtime](/integrators/agent-runtime) (external-action flow),
> [Control access](/guide/permissions) (grants), and
> [Identity and runtime authentication](/security/identity) (run proof).

## Responsibility split

| Component | Responsibility |
|---|---|
| OpenCrane MCP registry | Definitions, revisions and organisation-scoped publication |
| Run input compiler | Freezes the allowed tool revisions for one run |
| OpenCrane action executor | Re-derives arguments, checks approval and records receipts |
| Obot custody adapter | Invokes the authorised MCP operation without exposing credentials |
| Runtime Job | Emits an action candidate and receives only the authorised result |

An MCP registration does not by itself grant an agent access. The acting subject and agent
service must both pass membership and grant resolution before the tool revision enters the
run's compiled capability set.

## Invocation flow

```text
runtime emits external_action candidate
       │
       ▼
OpenCrane verifies run proof and arguments digest
       │
       ├── approval required ──► durable approval request
       │
       ▼
reserve one tool invocation
       │
       ▼
Obot custody executes authorised MCP call
       │
       ▼
receipt committed ──► result resumes the run
```

OpenCrane reserves the invocation before external I/O. Replays return the durable result or a
stable conflict rather than executing the external action twice.

::: info Current transport status
The registry, grant, approval and durable invocation authorities are implemented. The current
server composition injects an unavailable Obot custody adapter, so authenticated MCP execution
fails closed until that transport is mounted.
:::

::: warning
Never place MCP credentials or a direct Obot client in the runtime. That would let a model
response bypass grants, approvals and durable invocation receipts.
:::

## Failure posture

- An unregistered or ungranted tool revision is denied.
- An arguments-digest mismatch is denied.
- A required approval pauses the run.
- An unavailable custody adapter fails closed.
- A late result from a cancelled or replaced attempt is not accepted.

Source: [`libs/backend/server/gateways/mcp/main`](https://github.com/italanta/opencrane/blob/main/libs/backend/server/gateways/mcp/main/README.md)
and [`libs/backend/agents/execution/protocol`](https://github.com/italanta/opencrane/blob/main/libs/backend/agents/execution/protocol/README.md).
