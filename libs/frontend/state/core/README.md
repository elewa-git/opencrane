# @opencrane/state/core — shared state ports and session

The hub of the frontend state layer: the contracts every adapter implements and every feature
injects. Exports the `ConversationGateway` port + `ConnectionStatus` (including the transient
`Provisioning`/`Reconnecting` vs terminal `Refused` distinction), the `ConversationCache`
types, the `PLATFORM_SURFACE` token (the `"platform"` vs `"org"` split — two strictly-separated
surfaces with their own OIDC sessions, so a role claim only unlocks its own surface), and
`SessionStore` (identity, current tenant, and `computed` capabilities read from the
surface-appropriate `/auth/me` and `/tenants`).

Deliberately holds no gateway implementations: concrete network/storage adapters live in the
sibling `state/*/adapter` libs and are bound to these tokens by `@opencrane/state/gateways`.
Consumed by `apps/opencrane-ui`, the feature libs, and every state adapter.

Tagged `scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs —
never on backend packages or apps.
