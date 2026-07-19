# @opencrane/backend/feat-openclaw-tenant — frozen OpenClaw tenant reconciler

This package is a deletion boundary: the frozen blue OpenClaw platform, maintained only until the
personal-agent replacement lands, after which the whole package is deleted. Do not extend it, add
capabilities to it, or grow new dependencies on it — fixes are maintenance-only.

It owns the legacy in-silo tenant control loop. `OpenClawTenantLifecycle` is the composition
entrypoint the OpenCrane server starts (fail-soft boot preserved): it loads the app-owned
operator config, bootstraps the BYOK provider key, runs the standalone-only ClusterTenant/default
tenant seeds, heals the singleton Cognee identities, and starts the in-process channel proxy. The
core is the `Tenant` (UserTenant) CRD reconciler under `reconcilers/tenants/` — per-user OpenClaw
gateway workloads (ServiceAccount, ConfigMap, Deployment, state PVC, Service, network policies,
resource quota) fenced inside the owning ClusterTenant's namespace, plus the idle-suspension
checker, model gating, per-tenant LiteLLM keys, encryption keys, and seeded workspace files.
`_OperatorConfigChecksum` digests the reconcile-affecting config for the reconcile guard.

Consumed only by `apps/opencrane` (index, config, hosting-adapter factory). Tagged
`scope:feat-openclaw-tenant` with no scope-level depConstraint in `eslint.config.mjs`; it reaches
into cluster-tenants, model-routing, policies, and the `_infra` channel-proxy, a breadth tolerated
precisely because the package dies by replacement rather than being untangled.
