# @opencrane/state/settings/adapter — tenant settings gateway adapter

Owns the `SettingsGateway` port and its live implementation, `OpenCraneSettingsGateway`, over
the Control Plane's Tenants API (typed `GET`/`PUT /tenants/{name}` via the shared
`ControlPlaneApiService`, generated from the pinned contract). The mapper utils project the
`Tenant` wire shape onto the settings read models: `AccountProfile` (and the update→patch
mapping), `PodIdentity`, `BudgetSpend`, dataset access, egress domains, and the awareness
contract info.

The mapping layer is the point: features program against the read models and never see the
raw tenant wire shape, so contract drift is absorbed here. WeOwnAI never imports OpenCrane
source; this network contract is the only coupling.

Consumed by `@opencrane/features/settings`; bound to `SETTINGS_GATEWAY` by
`@opencrane/state/gateways`. Tagged `scope:web`/`type:state`: may depend only on `scope:web`
and `scope:shared` libs — never on backend packages or apps.
