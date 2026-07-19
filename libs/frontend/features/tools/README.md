# @opencrane/features/tools — MCP tools user/admin screens

Owns both faces of the MCP tools UI. `TOOLS_ROUTES` (mounted by the workspace shell under
`/tools`) serves end users: My Tools with connection status, the browse-and-install catalogue,
and the connect drawer. `MCP_ADMIN_ROUTES` (mounted by `apps/opencrane-ui` under `/admin`)
serves admins: catalogue governance, access policy, and model-keys (BYOK) management.

Admin screens gate themselves in-component on the `customerAdmin` capability; the control
plane is the real enforcement point. All data goes through the `MCP_GATEWAY`
(`@opencrane/state/mcp/adapter`) and `PROVIDER_KEY_GATEWAY`
(`@opencrane/state/provider-key/adapter`) ports — the feature never issues HTTP directly and
never sees credential material back from the API (keys are write-only).

Consumed by `apps/opencrane-ui` and `features/workspace`. Tagged `scope:web`/`type:feature`:
may depend only on `scope:web` and `scope:shared` libs — never on backend packages or apps.
