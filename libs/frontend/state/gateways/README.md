# @opencrane/state/gateways — gateway DI composition root

Owns the single place where the swappable data-gateway ports meet their live implementations:
`provideControlPlaneGateways()` binds `CONVERSATION_GATEWAY`, `SETTINGS_GATEWAY`,
`USER_TENANT_GATEWAY`, `MCP_GATEWAY`, and `PROVIDER_KEY_GATEWAY` to their OpenCrane adapters
and sets `GATEWAY_MODE` (`"mock"`/`"live"` — one flag, not scattered edits). Also exports
`ActiveTenantStore`, which reconciles `SessionStore.currentTenant` with the mode so consumers
read one `tenant` signal and never resolve targets themselves.

This is deliberately the only lib that knows every adapter — features and elements inject the
tokens from `@opencrane/state/core` and stay implementation-blind. There is no mock mode in
production code; test fakes come from the `__test__` package.

Consumed by `apps/opencrane-ui` (app providers) and `features/settings`. Tagged
`scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs — never on
backend packages or apps.
