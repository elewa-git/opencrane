# Agent runtime

`apps/agent-runtime` owns the identity and network boundary of the workload in which agent work
executes. It is the deliberately powerless half of the run substrate: the agent controller
(`apps/agent-controller`) creates the actual Job per run, while this app owns the standing
ServiceAccount and policies that Job runs under.

The app renders only a ServiceAccount and NetworkPolicies — no Deployment and no persistent volume,
because runtime work is a per-run Job, not a resident service. The identity is stripped by design:
zero Kubernetes RBAC, no auto-mounted API token, a deny-by-default ingress policy, and egress limited
to DNS and telemetry. It has no network path to the OpenCrane server; a future proof-bound bootstrap
path (Phase E) must use a dedicated listener rather than the shared internal port, so the boundary
here is inert until that lands.

This app is the standing proof that agent runtimes hold no cluster authority. The negative tests in
`scripts/runtime-identity-negative-tests.sh` fail if the runtime identity ever gains a permission or
loses its lockdown.
