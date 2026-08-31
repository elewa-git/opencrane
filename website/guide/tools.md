# Manage tools with MCP

A **tool** lets an agent reach into another system — send a message, update a record, search a
calendar. OpenCrane uses the Model Context Protocol (MCP) to register those integrations, and
keeps the approval decision and the record of every call outside the runtime that proposes it: a
compromised or misbehaving agent run cannot widen its own tool access.

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
approval when required and saves the invocation before work starts. After approval OpenCrane issues
one claim for the exact admitted OCI MCP image. A dedicated executor Job saves the checked result
before the runtime can continue.

::: info
The uploaded MCP server receives no OpenCrane token, Service or ingress. A fixed companion owns the
short-lived workload token and accepts only MCP `2026-07-28` over Pod-local networking.
:::

::: tip
Revoking a grant changes future decisions. It does not rewrite the evidence of an action that
an earlier run already completed.
:::

## Going deeper

See the [OCI MCP runtime deep dive](/integrators/oci-mcp-runtime),
[governed packages and container images](/integrators/governed-packages), and the
[central authorization authority](/integrators/authorization-authority).
