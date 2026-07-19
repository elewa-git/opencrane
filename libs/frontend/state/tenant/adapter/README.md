# @opencrane/state/tenant/adapter — UserTenant gateway and store

Owns the `USER_TENANT_GATEWAY` port, its live implementation `OpenCraneUserTenantGateway`
(typed calls against `/tenants`, `/tenants/{name}`, and the suspend/resume actions on the
Control Plane API), and `UserTenantStore` — a headless signal store over the UserTenant
collection (the OpenClaw pods inside a customer's ClusterTenant) with `computed` selectors and
optimistic suspend/resume that reconciles or rolls back after the network call.

Contract quirks are absorbed here: the pinned contract has no parent-ClusterTenant field, so
`team` carries it and maps onto `clusterTenantRef`; there is no list-scoping query parameter,
so `list(ref)` filters client-side. The store injects only the gateway token, so mock and live
implementations are interchangeable via the app's provider binding.

Consumed by `@opencrane/features/customer-admin`; bound live by `@opencrane/state/gateways`.
Tagged `scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs —
never on backend packages or apps.
