# ADR 0002 — Per-ClusterTenant silo architecture

- **Status:** Accepted
- **Date:** 2026-06-26
- **Task:** `task_5164276f`
- **Related:** [ADR 0003](0003-cilium-spiffe-identity-substrate.md) ·
  [`apps/_infra/deploy-k8s`](../../apps/_infra/deploy-k8s)

## Context

An organisation needs a stable technical boundary that does not depend on every request and data
access correctly disambiguating a shared tenant coordinate. The deployment topology must also
support explicit workload identity, default-deny networking, isolated credentials, and independent
recovery.

`ClusterTenant` is the infrastructure coordinate for that organisation boundary. Product records
carry a `siloId`; host resolution, workload assignments, database constraints, and service policies
must all agree on it.

## Decision

Each supported `ClusterTenant` runs as one isolated OpenCrane silo:

- a dedicated namespace and release;
- one tenant-facing OpenCrane API and database authority;
- release-owned model, memory, and integration dependencies where enabled;
- dedicated service accounts and narrowly projected token audiences;
- default-deny network policy with explicit destinations; and
- organisation-specific ingress, DNS, certificate, and OIDC client binding.

The silo is the tenant-facing scope. A request must not select a different organisation through an
untrusted body, query parameter, header, or workload-supplied coordinate. Cross-silo operations use
an explicitly named `ClusterTenant` and a separate platform authority.

The deployment entry point is
[`apps/_infra/deploy-k8s/deploy.sh`](../../apps/_infra/deploy-k8s/deploy.sh). Its values and templates
own the namespace, per-silo database, identity, ingress, and network-policy composition.

Dedicated compute is an independent scheduling choice. Multiple silos may share cluster nodes while
remaining separate namespaces, releases, identities, databases, and policy boundaries.

## Alternatives considered

- **A shared tenant-facing API and data plane selected by request coordinates** — rejected because
  it makes isolation depend on repeated tenant-resolution logic.
- **One shared model, memory, or integration plane with application-level partitioning only** —
  rejected as the default because credentials and data would share a failure domain.
- **A dedicated Kubernetes cluster for every organisation** — not required by this decision.
  Compute isolation can be added without changing the product authority boundary.

## Consequences

- Every persistent record and workload assignment carries a silo coordinate that is validated at
  the owning boundary.
- Each service exposes only the network and credential paths required inside its silo.
- Operators deploy, back up, restore, observe, and upgrade silos as independent units.
- A new cross-silo component requires an explicit platform authority and cannot inherit access from
  network location.
