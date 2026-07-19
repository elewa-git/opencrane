# Agent controller

`apps/agent-controller` owns the only component permitted to create agent workloads in the cluster.
It reconciles OpenCrane's desired runs into Kubernetes Jobs, and it is deliberately the sole holder
of workload-mutation rights so that no runtime, and no other app, can schedule execution.

The controller never acts on its own judgement. It claims desired work over OpenCrane's internal
authority API — authenticated with its audience-bound workload token and refused unless the run
attempt, state, and runtime profile still match — then renders the corresponding agent-runtime Job
in a suspended, powerless state and records the Job and Pod back to OpenCrane. It unsuspends only
after OpenCrane confirms bootstrap readiness. Stale attempts, changed profiles, and unverified
callers are rejected at the source. Reconciliation logic and the Kubernetes adapter live in
`libs/backend/agent-controller/{main,kubernetes}`; this app is the deployable shell.

The workload runs as a single reconciler Deployment with no auto-mounted token and a namespaced Role
scoped to exactly `jobs` (create/patch/delete) and `pods` (read) — no ClusterRole, no other verbs,
no access to secrets or the wider cluster. Its NetworkPolicy permits egress only to the Kubernetes
API server and OpenCrane's internal port. Readiness requires both a successful reconcile pass and
Kubernetes API reachability; liveness is independent so long reconciles never trigger a restart.
