# deploy-k8s — silo umbrella chart & deploy entrypoint

> [apps](../../README.md) › [_infra](../README.md) › deploy-k8s

<!-- No import alias: this deployable is a Helm umbrella chart plus a deploy script.
     Named by its `project.json` (`deploy-k8s`). This README is the overview altitude;
     the deep detail lives in the linked sub-docs. -->

## What it owns

This is the **install root** for one **silo** — one customer's isolated slice of OpenCrane. The
trusted services run in the release namespace; untrusted personal-agent Jobs run in a sibling runtime
namespace owned by the same release. Nothing is shared with other customers. Everything else under `apps/` ships a small
Helm named-template library; this app is the **umbrella chart** (`opencrane-silo`) that pulls those
libraries together into one release, plus `deploy.sh`, the entrypoint that installs and upgrades it.

Think of it as the assembly point: each app owns its own workload templates, and this chart composes
them — unchanged — with one shared release context. It renders nothing customer-specific itself; it just
wires the pieces and the per-silo networking together.

```
 deploy.sh  (per-ClusterTenant silo profile)
        │  helm dep build (from Chart.lock) → helm upgrade --install
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │  opencrane-silo umbrella chart  ◄── HERE                     │
 │    composes app-owned template libraries into one release:   │
 │    server · opencrane-ui · channel-proxy · artifact-service  │
  │    · agent-controller · cognee · litellm · obot · langfuse   │
 └────────────────────────────────────────────────────────────┘
        │  requires (external prerequisites, NOT installed here)
        ▼
 ingress-nginx · external-dns · CloudNativePG · cert-manager issuer
```

**In this flow:** [opencrane server](../../opencrane/README.md) · [opencrane-ui](../../opencrane-ui/README.md)
· [channel-proxy](../../channel-proxy/README.md) · [artifact-service](../../artifact-service/README.md)
· [agent-controller](../../agent-controller/README.md)
· [postgres](../../postgres/README.md) · [cognee](../cognee/README.md) · [litellm](../litellm/README.md)
· [obot](../obot/README.md) · [langfuse](../langfuse/README.md)

A silo installs **only** its own namespaced app releases. Cluster-wide controllers (ingress-nginx,
external-dns, CloudNativePG, cert-manager) are external prerequisites a silo never installs. Dependencies
resolve from `Chart.lock` via `helm dep build` (pinned, reproducible) — never from open version ranges.

The personal `agent-runtime` image is deliberately absent from the long-lived Deployment rollup. It is not a
long-lived silo service: the agent controller creates its bounded, suspended Job for each authorised
run attempt and commits the Kubernetes-issued Job identity to OpenCrane. Workload lifetime and
Kubernetes identity therefore remain tied to that attempt. The release still owns the runtime
namespace, its zero-RBAC ServiceAccount, default-deny and fixed-egress policies, and a uniquely named
cluster-scoped admission policy that permits only the exact digest-pinned Job shape and its one-time
unsuspend transition. An aggregate ResourceQuota bounds conforming Jobs, Pods, CPU, and memory even
if the controller identity is compromised. The admission boundary requires Kubernetes 1.30+.

## Public surface

`Entrypoint: deploy.sh` — the per-ClusterTenant silo deploy profile, a thin wrapper over the shared
install core (`platform/k8s-deploy.sh`). It requires a base domain, a ClusterTenant name, and one
pre-created PostgreSQL basic-auth Secret per logical database (server, obot, litellm, langfuse).

## Boundary

The umbrella renders no business logic and installs no cluster-wide controller. It composes app-owned
templates, the server and runtime namespaces, per-silo `NetworkPolicies`, and the runtime Job's
release-scoped `ValidatingAdmissionPolicy`; it does not own the workloads themselves (each app does) or
the shared substrate helpers (the `k8s-platform` library does). Self-service ClusterTenant management and
billing are OFF — a silo serves exactly one ClusterTenant.

## Dependency direction

An app entrypoint (`type:app`); it composes app template libraries and the `k8s-platform` substrate. No
package imports it.

## Runtime & config

- Umbrella chart: `Chart.yaml` (`opencrane-silo`), values in `values.yaml`, schema in
  `values.schema.json`, pins in `Chart.lock`.
- `agentController.runtimeNamespace` — optional DNS-label override for the sibling runtime namespace;
  empty derives `<release>-runtime`, and the chart rejects the trusted server namespace.
- `agentController.runtimeQuota` — aggregate Job, Pod, CPU, and memory ceilings for the dedicated
  untrusted runtime namespace.
- `crds.install` — defaults `true` (standalone: this chart installs the ClusterTenant/Tenant/AccessPolicy
  CRDs); set `false` when running under a fleet that installs its own CRDs.
- Reusable environment/multi-instance profiles live under `values/` and `platform/values/`.

## Sub-docs (the deep detail)

- **[platform/README.md](platform/README.md)** — the cluster and release substrate: the `k8s-platform`
  Helm library (labels, names, RBAC, endpoint/database/identity/observability helpers), the
  `k8s-deploy.sh` install engine, OIDC configuration, cluster provisioning, Terraform, values profiles,
  and the k3d conformance tests.
## See also

- Parent index: [_infra](../README.md)
- Composed apps: [opencrane server](../../opencrane/README.md) · [opencrane-ui](../../opencrane-ui/README.md)
· [channel-proxy](../../channel-proxy/README.md) · [artifact-service](../../artifact-service/README.md)
  · [agent-controller](../../agent-controller/README.md)
  · [postgres](../../postgres/README.md)
- Composed infra: [cognee](../cognee/README.md) · [litellm](../litellm/README.md) ·
  [obot](../obot/README.md) · [langfuse](../langfuse/README.md)
