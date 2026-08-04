# Manage tools with MCP

A **tool** lets an agent request an action in another system. OpenCrane uses MCP for tool
registration while keeping credentials, approvals and invocation receipts outside the runtime.

## Register a tool

Use the authenticated `/api/v1/mcp-servers` surface to register and review MCP definitions.
Retrieve current payloads through the [API reference](/reference/api).

## Grant it

A registration is not a grant. Allow the required tool revision for both the acting subject
and the agent service. New runs freeze the resulting capability set.

## Execute safely

The runtime proposes a tool call. OpenCrane validates the run proof and arguments, opens an
approval when required and reserves the invocation. After approval the runtime executes the call
directly against Obot with a short-lived attempt-scoped key and reports back only a result digest.
Integration credentials stay with Obot; they never enter the runtime or browser.

::: info
The registration, grant, approval, receipt, custody and direct-invocation authorities are present.
The Obot transports compose only when the deployment mounts the Obot service credential; without
it execution fails closed after reservation. Live-Obot qualification remains gated on issue #337.
:::

::: tip
Revoking a grant changes future decisions. It does not rewrite the evidence of an action that
an earlier run already completed.
:::

## Going deeper

See the [MCP gateway deep dive](/integrators/mcp-gateway).
