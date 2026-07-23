# Networking & network isolation

OpenCrane organises all cluster traffic into **two distinct planes**: a narrow public edge that terminates TLS and routes DNS, and a fully private internal network where every platform service runs as a ClusterIP. Understanding the boundary between them — and how the operator bridges it safely — is the mental model you need to operate, debug, and harden the platform.

> See also:
> [Silo deployment model](/operators/silo-deployment) — how the central + per-ClusterTenant silo releases are installed and what each renders; the deployment context for this isolation model.
> [Identity & connection auth](/security/identity) — how OIDC sessions and projected-identity tokens authenticate traffic across the planes.
> [Connection security](/security/connection-security) — the full threat model and adopted posture for the browser-to-pod WebSocket.
> [DNS configuration](/operators/dns-config) — how external-dns and cert-manager manage the DNS/TLS side of plane 1.
> [Hosting & deployment](/operators/hosting) — ingress class, TLS cert modes, and cloud hosting adapters.

---

## The two planes at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  PLANE 1 — PUBLIC EDGE                                              │
│                                                                     │
│  Internet ──► single LoadBalancer IP (ingress-nginx)                │
│                │                                                    │
│                ├── platform host  (dev.opencrane.ai / apex)         │
│                │     └── /  ──► opencrane-api Service :8080         │
│                │                                                    │
│                └── org wildcard  (*.dev.opencrane.ai)               │
│                      ├── /api/*   ──► opencrane-api Service :8080   │
│                      ├── /gateway ──► gateway-proxy Service :8090   │
│                      └── /        ──► org control-UI (SPA)          │
│                                                                     │
│  TLS: *.<base> wildcard cert (DNS-01)  +  per-org vanity cert       │
│  DNS: platform records (manual/Terraform) + per-org A records       │
│       written by external-dns from DNSEndpoint CRs                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                   operator gateway-proxy
                   (identity-routing seam)
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  PLANE 2 — INTERNAL CLUSTER NETWORK (ClusterIP only)                │
│                                                                     │
│  opencrane-api :8080    mcp-gateway :8080    feat-skill-registry :5000   │
│  litellm :4000          cognee :8000         PgBouncer (CNPG) :5432 │
│                                                                     │
│  per-org namespaces (opencrane-<org>):                              │
│    openclaw-<tenant> :18789  (no Ingress, no public DNS)            │
│                                                                     │
│  Isolated by Cilium identity policy + SPIFFE mTLS (per silo)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Plane 1 — the public edge

### What is publicly reachable

Exactly two host classes ever receive external traffic. Everything else is ClusterIP-only and is unreachable from outside the cluster by design.

| Host | Example (dev) | Resolves to | Routes to |
|------|--------------|-------------|-----------|
| Control-plane host | `dev.opencrane.ai` | LoadBalancer IP | opencrane-api Service :8080 |
| Per-org host | `acme.dev.opencrane.ai` | LoadBalancer IP | org control-UI SPA (`/`) + gateway-proxy :8090 (`/gateway` WebSocket) + opencrane-api :8080 (`/api/*`) |

The opencrane-api host is either the apex (`<base>`) or a dedicated `platform.<base>`, controlled by the chart value `ingress.controlPlaneHost`. The dev cluster uses the apex directly (`dev.opencrane.ai`). The wildcard Ingress is rendered only when both `ingress.enabled` and `gatewayProxy.enabled` are true (see [`apps/_infra/deploy-k8s/templates/gateway-ingress.yaml`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/templates/gateway-ingress.yaml)).

There are **no per-user subdomains**. Every user in an org connects through one org host; the identity-routing proxy resolves each session to its own pod. All three surfaces are served **same-origin** under that one host: the org control-UI owns `/`, opencrane-api owns `/api/*`, and the gateway WebSocket is routed at `/gateway`.

### How an org host resolves

When a new org is provisioned, the operator's domain provisioner ([`apps/fleet-operator/src/cluster-tenants/internal/org-domain.provisioner.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/fleet-operator/src/cluster-tenants/internal/org-domain.provisioner.ts)) creates a `DNSEndpoint` CR named `org-dns-<org>` in the org's namespace. This CR carries a single A record:

```
<org>.<base>  A  <ingress-ip>  TTL 300
```

external-dns (running with `--source=crd --policy=sync --domain-filter=<base> --provider=google`) reads the `DNSEndpoint` CR and reconciles it into the cloud DNS zone. Workload Identity grants the external-dns service account `roles/dns.admin` on the zone's project.

Creation is gated on two conditions: `ingress.externalIp` (the `INGRESS_IP` env var) must be set, and the `DNSEndpoint` CRD must be present. If either is absent, the provisioner skips DNS write and still returns `ready: false, skipped: true` — the org continues to reach the ready phase rather than failing hard. The platform-level records (`platform.<base>`, apex, wildcard `*.<base>`) are written once at install (Terraform or manually) and are never operator-managed.

### TLS

A single platform wildcard cert (`*.<base>`) covers every `<org>.<base>` host. The cert also carries explicit SANs for the opencrane-api host and the apex. It is issued by cert-manager via ACME DNS-01 (wildcards require DNS-01) into the Secret named by `ingress.tls.secretName` (default `opencrane-wildcard-tls`; v3 in dev). The wildcard Ingress and the opencrane-api Ingress both reference this Secret.

The wildcard matches exactly one DNS label, so `*.<base>` covers `<org>.<base>` but not `<user>.<org>.<base>`. This is intentional — there are no per-user subdomains, so a second wildcard level is neither needed nor issued.

When a ClusterTenant has a `vanityDomain` set, the operator issues a separate per-org HTTP-01 certificate (SAN = the vanity host only). The customer adds a CNAME at their own provider pointing their domain at the org's canonical host; no DNS-01 is needed because it is a non-wildcard name.

::: tip One wildcard level is enough
Because all users share the org host, the `*.<base>` cert is the only wildcard the platform ever needs. No per-org wildcard certs and no per-org DNS-01 challenges are required.
:::

---

## Plane 2 — the internal cluster network

### Internal services and their ports

All platform services are ClusterIP-only. No plane service exposes an Ingress or a public DNS record. Traffic between them travels over `<release>-<svc>.<namespace>.svc.cluster.local`.

| Service | Port | Namespace |
|---------|------|-----------|
| opencrane-api | 8080 | opencrane-system |
| mcp-gateway (Obot) | 8080 | opencrane-system |
| feat-skill-registry | 5000 | opencrane-system |
| litellm | 4000 | opencrane-system |
| cognee | 8000 | opencrane-system |
| PgBouncer pooler (CNPG-managed) | 5432 | opencrane-system |
| openclaw-`<tenant>` (per-org) | 18789 | opencrane-`<org>` |

Tenant (openclaw) pods run in per-org namespaces (`opencrane-<org>`), one pod per user. They have no Ingress and no public DNS record. The ClusterIP Service for each tenant pod is `openclaw-<tenant>`.

### The authenticated operator seam

The only path from the public internet into a tenant pod passes through three independent enforcement layers. All three must pass; any one failing closes the connection.

```
browser ── wss://<org>.<base>/gateway + OIDC cookie ──► wildcard Ingress (*.<base>)
                                                       │
                                               gateway-proxy (in operator pod)
                                                       │
                                    ┌──────────────────┼──────────────────────┐
                                    │  Layer 1: NetworkPolicy (L4)             │
                                    │  admits TCP :18789 ONLY from             │
                                    │  namespace=opencrane-system,             │
                                    │  component=operator                      │
                                    └──────────────────┼──────────────────────┘
                                                       │
                                    ┌──────────────────┼──────────────────────┐
                                    │  Layer 2: trusted-proxy auth (L7)        │
                                    │  gateway accepts X-Forwarded-User only   │
                                    │  from GATEWAY_TRUSTED_PROXIES CIDR       │
                                    │  (dev: 10.8.0.0/14 = cluster pod CIDR)  │
                                    └──────────────────┼──────────────────────┘
                                                       │
                                    ┌──────────────────┼──────────────────────┐
                                    │  Layer 3: owner pinning (identity)       │
                                    │  allowUsers=[owner email] rejects any    │
                                    │  forwarded identity ≠ pod owner          │
                                    └──────────────────┼──────────────────────┘
                                                       │
                                              tenant OpenClaw pod :18789
```

**Layer 1 — NetworkPolicy (L4).** The operator builds and applies a per-tenant NetworkPolicy named `openclaw-<tenant>-gateway` (see [`apps/fleet-operator/src/tenants/deploy/network-policy.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/fleet-operator/src/tenants/deploy/network-policy.ts)). It selects the tenant pod by its labels and admits ingress to port 18789 from exactly one source: pods with `component=operator` in the namespace labelled `kubernetes.io/metadata.name=opencrane-system`. No other in-cluster pod can reach the gateway port. Without this policy, any pod that knew the ClusterIP could assert an arbitrary `X-Forwarded-User` header and be trusted.

**Layer 2 — trusted-proxy auth (L7).** The OpenClaw gateway runs in `trusted-proxy` mode and accepts the `X-Forwarded-User` identity header only from sources listed in `GATEWAY_TRUSTED_PROXIES` (the cluster pod CIDR; dev = `10.8.0.0/14`). OpenClaw fails closed on an empty `trustedProxies` list.

**Layer 3 — owner pinning.** `gateway.auth.trustedProxy.allowUsers` is rendered by the operator to contain only the pod owner's email. Any `X-Forwarded-User` that does not match is rejected at the pod. This is a cross-tenant guard that is independent of routing: even if the proxy ever mis-routed a socket to the wrong pod, the pod would reject the mismatched identity.

The security argument for this three-layer seam is detailed in [connection security](/security/connection-security) and [authentication](/security/identity).

### Plane ingress NetworkPolicies

The silo chart renders per-plane ingress NetworkPolicies when `networkPolicy.enabled` is true (see [`apps/_infra/deploy-k8s/templates/networkpolicy-planes.yaml`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/templates/networkpolicy-planes.yaml)).

| Policy | Protects | Admits ingress from |
|--------|----------|---------------------|
| `*-opencrane-api-ingress` | opencrane-api :8080 | ingress-nginx namespace + operator + mcp-gateway + feat-skill-registry + tenant pods (contract re-pull) |
| `*-mcp-gateway-ingress` | mcp-gateway :8080 | tenant pods + opencrane-api + operator |
| `*-feat-skill-registry-ingress` | feat-skill-registry :5000 | tenant pods + opencrane-api + operator |
| `*-skill-oci-ingress` | skill OCI store | opencrane-api only |

Tenant pods reach the control plane to re-pull their effective contract (`GET /api/internal/contract/:name`); the policy allows this, and the handler enforces identity via TokenReview — so network and application auth are both in play.

Tenant-to-plane calls carry **audience-bound projected-identity tokens** mounted at `/var/run/opencrane/tokens`. The plane enforces app-level auth on these tokens in addition to the network-layer policy.

---

## The per-silo default-deny baseline

Each ClusterTenant (org) is modelled as a strictly isolated **silo**. The operator now emits a per-silo default-deny baseline `NetworkPolicy` in **every** ClusterTenant namespace as it provisions the silo — `_BuildSiloBaselineNetworkPolicy` (see [`apps/fleet-operator/src/tenants/deploy/silo-baseline-network-policy.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/fleet-operator/src/tenants/deploy/silo-baseline-network-policy.ts)), named `opencrane-<cluster-tenant>-silo-baseline`.

The policy uses an **empty `podSelector`** (it selects every pod in the silo namespace) and names both `Ingress` and `Egress` in `policyTypes`, which flips the namespace to **default-deny**: anything not explicitly allowed below is dropped. The allow-list is the minimum a silo needs to function while staying isolated from every *other* silo — there is no silo→silo path because no rule ever names another silo namespace:

| Direction | Allowed | Why |
|-----------|---------|-----|
| Ingress | the same silo namespace (intra-silo) | pods within one org talk to each other |
| Ingress | the opencrane-api / operator namespace | the super-admin plane is the only principal allowed to reach inward (it brokers the gateway connection) |
| Egress | cluster DNS (`kube-system`, UDP/TCP 53) | without this every name lookup fails and the pod is dead |
| Egress | the same silo namespace + the opencrane-api / operator namespace | reach the shared planes (opencrane-api, Obot/MCP, feat-skill-registry, LiteLLM, Cognee) in the shared tier |
| Egress | external HTTPS (TCP 443) | the agent legitimately calls out to LLM / MCP / Git endpoints |

This **replaces the retired `opencrane-tenant-default` policy**, which sat in the install namespace (`opencrane-system`) and selected tenant pods cluster-wide by `app.kubernetes.io/component=tenant` — so it governed nothing in the per-org namespaces where tenant pods actually run, leaving egress unrestricted there. The operator now emits one correctly-scoped policy per silo namespace it provisions, so egress (DNS + HTTPS only) and east-west default-deny are enforced in the right place. The companion per-tenant gateway policy (`openclaw-<tenant>-gateway`, [Layer 1](#the-authenticated-operator-seam) above) narrows the gateway *port* to the operator on top of this baseline; `NetworkPolicy` rules are additive, so the two compose.

::: tip Enforcement is CNI-dependent
This baseline is an **L3/L4** floor — a namespace-scoped, port-keyed allow-list. It only takes effect on a `NetworkPolicy`-enforcing CNI: GKE Dataplane V2 (and Autopilot) enforce it inherently; Calico/Cilium do elsewhere. On a CNI that does not enforce `NetworkPolicy`, the floor is inert.
:::

### Identity-keyed enforcement (Cilium + SPIFFE)

The baseline above is keyed on namespaces and ports. On top of it, the platform enforces isolation on **workload identity** and at **L7**, using Cilium + SPIFFE. Every silo workload is issued a SPIFFE SVID (`spiffe://opencrane/ct/<org>/<workload>`) derived from its Kubernetes ServiceAccount, and every silo-to-silo call is mutually authenticated (mTLS). `CiliumNetworkPolicy` then expresses the same default-deny + allow-intra-silo + allow-super-admin posture — but keyed on that cryptographic identity rather than on an IP, and extended to per-route (L7) authorisation. The `NetworkPolicy` floor stays in place underneath (Cilium enforces it too), so the two compose as defence in depth.

See [Identity & network isolation (Cilium + SPIFFE)](/operators/cilium-spiffe-identity) for the full model — the two kinds of identity, the who-can-talk-to-whom rules, and how a workload gets its identity. See [ADR 0003 — Cilium + SPIFFE identity substrate](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0003-cilium-spiffe-identity-substrate.md) for the substrate decision (it supersedes the earlier Linkerd choice in ADR 0001).

Egress is bounded the same way: `CiliumNetworkPolicy` `toFQDN` rules give each silo a per-hostname allow-list (e.g. only `api.openai.com`), so a silo reaches DNS and its approved provider/tool endpoints and nothing else. An `AccessPolicy` with `egressRules` narrows this further per tenant.

The OpenCrane server also owns a portable egress policy. It admits the CNPG-managed PgBouncer pooler, Kubernetes and external HTTPS, DNS, release-local LiteLLM/Cognee/Langfuse/OTEL services, tenant gateways, the GKE metadata endpoint when selected, and the cross-namespace ArtifactStore byte plane. Kubernetes API rules can carry both the exact Service address and exact backing endpoint because CNIs may enforce policy before or after Service destination translation. Shared LiteLLM and bring-your-own Cognee endpoints must use HTTPS. Standard `NetworkPolicy` can restrict that external traffic only by port; use the Cilium FQDN layer when it must be narrowed to named hosts.

---

## Current enforcement status and known gaps

The following gaps are honest assessments verified against the live codebase. They do not undermine the overall isolation model but operators should be aware of them.

**litellm, langfuse, and the otel-collector have no ingress NetworkPolicy.** The plane ingress policies cover the control plane, mcp-gateway, feat-skill-registry, and OCI store. LiteLLM, Langfuse, and the OTEL collector are not yet covered by a corresponding ingress policy — a defence-in-depth gap. Application-level auth still applies on those services.

**Plane ingress rules use tenant podSelectors without a namespaceSelector.** The rules admitting tenant pods to the control plane and plane services select by `app.kubernetes.io/component=tenant` without scoping to the correct namespace. In a multi-instance cluster, a tenant pod from a different instance's namespace could match. This is a multi-instance hygiene gap; the fix is to also add a `namespaceSelector` that constrains to the instance's own org namespaces.

**The L3/L4 floor is the safety net beneath the identity layer.** Identity-keyed enforcement (Cilium + SPIFFE, above) is the primary cross-silo control; the portable `NetworkPolicy` floor stays underneath as defence in depth. The floor takes effect on a `NetworkPolicy`-enforcing CNI — with Cilium as the CNI it is enforced natively alongside the `CiliumNetworkPolicy` identity rules. On any CNI that does not enforce `NetworkPolicy`, the floor is inert and isolation rests on the identity layer alone.

---

## See also

- [Identity & network isolation (Cilium + SPIFFE)](/operators/cilium-spiffe-identity) — the identity-keyed layer on top of this L3/4 baseline: the principals, the who-can-talk-to-whom rules, SPIFFE SVIDs, and FQDN egress
- [ClusterTenant members](/operators/cluster-tenant-members) — managing who can administrate an org (Owner/Admin/Member roles) and the last-owner guardrail
- [Identity & connection auth](/security/identity) — credential types, OIDC session, projected-identity tokens, and the identity-routing proxy flow
- [Connection security](/security/connection-security) — the full CONN.9/CONN.10 threat model, the trusted-proxy auth decision record, and the transport hardening posture
- [DNS configuration](/operators/dns-config) — external-dns setup, cert-manager issuers, and the zone-write identity model
- [Hosting & deployment](/operators/hosting) — ingress class, TLS cert modes, cloud hosting adapters
- [ADR 0003 — Cilium + SPIFFE identity substrate](https://github.com/elewa-git/opencrane/blob/main/docs/adr/0003-cilium-spiffe-identity-substrate.md) — the substrate decision behind identity-keyed enforcement (supersedes ADR 0001, which chose Linkerd)
