# @opencrane/features/tools — tools and tool-governance routes

> [frontend](../../README.md) › [features](../README.md) › tools

## What it owns

This is a frontend **feature** package (lazy-loaded routes plus their components — the browser only
downloads a screen's code when it is first opened). It owns everything to do with **MCP servers** in
the UI. MCP is the Model Context Protocol, the standard for connecting external tools to an agent;
an MCP server is one such tool the user can install. This package ships two separate route tables:

- User-facing (`/tools`): **My Tools** — the user's installed servers and their connection status —
  and a **catalogue** to browse and install the servers they are entitled to.
- Admin (`/admin`): tool **governance** for a customer admin — catalogue governance and model keys —
  each screen gating itself on the admin capability. Generic central grant administration owns MCP
  sharing outside this feature.

The screens read connection and key state from client-side **stores/gateways** (a gateway is an
injection token that is the port to the opencrane-server HTTP API) and render it; the server stays
the authority on what a user may install or govern.

## Public surface

- `TOOLS_ROUTES` — the user-facing route table (My Tools at `""`, catalogue at `"catalogue"`).
- `MCP_ADMIN_ROUTES` — the admin route table (catalogue-admin and model-keys).
- `theme.scss` — the feature-owned shared presentation for tools/admin layouts, tables, inputs,
  callouts, actions, and connection-status indicators; the SPA composes this public style entrypoint.

## Boundary

`TOOLS_ROUTES` is mounted by the workspace shell under `/tools`; `MCP_ADMIN_ROUTES` is mounted by
`apps/opencrane-ui` under `/admin`. In-component capability gates only hide controls — the API is
the real enforcement point.

## Dependency direction

Tagged `type:lib`, `layer:frontend`, and `scope:web` (the frontend dependency tier): it may import
only other legacy `scope:web` packages, the bounded `scope:frontend-session`, and `scope:shared`
contracts. It depends on `@opencrane/state/session`
(session store), `@opencrane/state/mcp/adapter` (the MCP gateway), and
`@opencrane/state/provider-key/adapter` (the provider-key gateway and status).

## See also

- Parent index: [features](../README.md)
- Consumer: future workspace surface
- Gateways: [state/mcp/adapter](../../state/mcp/adapter/README.md) · [state/provider-key/adapter](../../state/provider-key/adapter/README.md)
