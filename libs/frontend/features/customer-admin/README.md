# @opencrane/features/customer-admin — customer's own admin console

Owns the `/customer-admin` route: a customer's own admin lists, suspends, and resumes the
UserTenants (the OpenClaw pods) inside *their* ClusterTenant. Exports the lazy
`CUSTOMER_ADMIN_ROUTES` table, `CustomerAdminPageComponent`, the phase-badge component, and
the pure row view-model types/utils.

Account-scoped by design — this is not the fleet-wide platform-operator view. Access is gated
in-component on `SessionStore.capabilities().customerAdmin`; the control plane remains the
real enforcement point. All data flows through `UserTenantStore` from
`@opencrane/state/tenant/adapter` (optimistic suspend/resume) — the feature issues no HTTP of
its own.

Lazy-loaded by `apps/opencrane-ui`'s route table. Tagged `scope:web`/`type:feature`: may
depend only on `scope:web` and `scope:shared` libs — never on backend packages or apps.
