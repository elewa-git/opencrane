# Manage tools (MCP)

::: tip What's a tool? What's MCP?
A **tool** lets an assistant *do* something in another system — send a Slack message,
file a Jira ticket, look up a customer in your CRM — instead of just talking about it.

Tools connect using a standard called **MCP** (Model Context Protocol). So when you
see "an MCP server," read it as "one connected tool."
:::

## Connect a tool

Register the tool once, by name and address through `POST /api/v1/mcp-servers`, and
list registrations with `GET /api/v1/mcp-servers`. These authenticated endpoints and
their payload schemas are in the [interactive API reference](/reference/api).

## Give it credentials (safely)

A tool usually needs to authenticate to the system it talks to. OpenCrane stores and
brokers those credentials **for** the assistant — they're never handed to the
assistant or the browser. Two modes are available:

- **Per-user sign-in** — each person authorises with their own account, so the
  assistant acts as *them*.
- **Shared credential** — one credential used on behalf of everyone.

## Decide who can use it

A connected tool isn't available to anyone until you grant it. Allow it for a person,
team, or whole department — see [Control access](/guide/permissions).

## Going deeper

How tool calls are routed, scoped, and audited is covered in the
[MCP gateway deep dive](/integrators/mcp-gateway).
