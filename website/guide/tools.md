# Manage tools with MCP

A **tool** lets an agent reach into another system — send a message, update a record, search a
calendar. OpenCrane uses the Model Context Protocol (MCP) to register those integrations, and
keeps the credentials, the approval decision and the record of every call outside the runtime
that executes it: a compromised or misbehaving agent run can't walk off with a live integration
credential.

Both kinds of agent use the same tool machinery — your personal assistant can only use the tools
granted to *you*; a managed agent can only use the tools its published revision was configured
with.

## Govern a tool

Use the authenticated `/api/v1/mcp` surface to browse, install and govern MCP definitions. The
public API does not expose a separate unsiloed registry or credential inventory. Retrieve current
payloads through the [API reference](/reference/api).

## Grant it

A registration is not a grant. Allow the required tool revision for both the acting subject
and the agent service. New runs freeze the resulting capability set.

## Execute safely

The runtime proposes a tool call. OpenCrane validates the run proof and arguments, opens an
approval when required and saves the invocation before work starts. After approval a server worker
executes the exact allowed call through Obot and saves the result before the runtime can continue.
Integration credentials and provider addressing never enter the runtime or browser.

::: info
The registration, grant, approval, durable invocation, custody and server execution authorities are present.
The Obot transports compose only when the deployment mounts the Obot service credential; without
it server preparation fails closed before a provider request starts. Live-Obot qualification
remains gated on issue #337.
:::

::: tip
Revoking a grant changes future decisions. It does not rewrite the evidence of an action that
an earlier run already completed.
:::

## Going deeper

See the [MCP gateway deep dive](/integrators/mcp-gateway).
