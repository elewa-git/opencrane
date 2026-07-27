# Running multiple instances

Multiple OpenCrane instances can share one Kubernetes cluster when each instance keeps its
**namespaces, release identity, database, secrets and public host** separate.

## Instance boundary

```text
cluster
├── instance acme
│   ├── trusted namespace
│   ├── personal runtime namespace
│   └── managed runtime namespace
└── instance globex
    ├── trusted namespace
    ├── personal runtime namespace
    └── managed runtime namespace
```

Each instance serves one `ClusterTenant` silo. An instance does not discover or manage the
other instance's organisations or workloads.

## Values that must differ

| Resource | Requirement |
|---|---|
| Helm release and namespaces | Unique per instance |
| Public host and TLS Secret | Unique routing identity |
| PostgreSQL databases and Secrets | No shared product authority |
| Runtime profiles | Point only to that instance's runtime namespaces |
| ServiceAccounts and admission policies | Release-scoped names |
| NetworkPolicy instance labels | Admit only same-instance traffic |

## Cluster-scoped prerequisites

Ingress, cert-manager, external-dns and the PostgreSQL operator may be shared cluster
controllers. Their ownership must be explicit, and installing another silo must not attempt to
replace them.

::: warning
Namespace separation alone is insufficient. A shared database, signing key or broadly matching
network rule can cross the instance boundary even when Pods live in different namespaces.
:::

## Validation

Render every instance profile and check for duplicate cluster-scoped names. Then run negative
connectivity tests in both directions and verify that a runtime token or Job from one instance
cannot bootstrap against the other.

→ [Hosting and deployment](/operators/hosting) ·
[Networking and isolation](/operators/networking)
