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

The screens read connection and key state through component-scoped **stores/gateways** (a gateway is an
injection token that is the port to the opencrane-server HTTP API) and render it; the server stays
the authority on what a user may install or govern.

Installed rows show `No credential required` only for the explicit Credentialless server state.
Remote servers, including credentialless ones, require a connection command and completed
discovery. The feature never infers readiness from single-user, multi-user, or OAuth presentation.
The same existing status chip renders `Activating`, `Active`, and `Recovery required` from the
server-owned connection projection. These labels report lifecycle state and never authorize a call.
The separate installation lifecycle keeps a `Removing` row visible after refresh while the server
settles existing work and cleans up credentials. That row disables another removal command. A later
authoritative list omits it once removal finishes; the browser does not erase it optimistically.

Personal connection controls compose inside the existing installed row's `[connection-control]`
slot. They expose Connect, token replacement and Disconnect through the generated API. The
presentational control receives values and emits intents; it never reads credentials or calls a
gateway. OAuth and managed-service connection setup remain separate work.

`PersonalMcpConnectionStore` owns ephemeral access-token drafts and exact retry commands. Tokens
never enter browser storage, inventory responses or error messages. A resolved command, access
loss or route destruction clears private drafts. An uncertain write retains the same key, original
generation expectation and material, and blocks other commands for that server. It can retry after
a refreshed projection shows a newer generation because the server compares that frozen expectation
before any replacement or revocation. A conflict rejects this retry and clears its private material.

The shared inventory store serves the catalogue and installed-tools routes. It owns authoritative
response adoption, bounded status refresh and the per-server command reservation shared by
connection changes and Uninstall. The page also exposes an explicit Refresh action. Separate administration
stores own catalogue transitions and write-only model-key drafts. Commands for the same server or
provider cannot overlap; independent targets keep separate pending state. Failed saves retain the
user's draft and late completions cannot clear a newer draft.

Each card or table row owns its template, styles and typed interaction outputs. Shared headings,
chips and asynchronous feedback come from `elements/ui`; route components compose these controls
and delegate to their stores. Search and installation joins are pure feature mappers.

```
 state gateway → route-scoped store → route → card / table row
                        ↑                          │
                        └──── typed user intent ───┘
```

**In this flow:** [MCP gateway](../../state/mcp/adapter/README.md) ·
[provider-key gateway](../../state/provider-key/adapter/README.md).

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
only other `scope:web` packages and `scope:shared` contracts. It depends on `@opencrane/state/core`
(session store), `@opencrane/state/mcp/adapter` (the MCP gateway), and
`@opencrane/state/provider-key/adapter` (the provider-key gateway and status).

## See also

- Parent index: [features](../README.md)
- Consumer: future workspace surface
- Gateways: [state/mcp/adapter](../../state/mcp/adapter/README.md) · [state/provider-key/adapter](../../state/provider-key/adapter/README.md)
