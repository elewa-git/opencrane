# Organisation boundary

A **ClusterTenant** identifies one customer organisation and its isolated OpenCrane silo.
Agent services, runs, grants, models and memory are always evaluated inside that boundary.

> See also: [Hosting and deployment](/operators/hosting) (install one silo),
> [Networking and isolation](/operators/networking) (namespace boundaries), and
> [Identity and runtime authentication](/security/identity) (membership and workload proof).

## What the boundary means

```text
ClusterTenant: acme
└── silo
    ├── trusted server namespace
    ├── personal runtime Job namespace
    ├── managed runtime Job namespace
    └── organisation-scoped data and policy
```

There is no Kubernetes resource for an individual user and no standing per-user runtime.
Users remain identity-provider subjects. Their current organisation membership and the accepted
agent revision are frozen into run evidence when OpenCrane admits work.

## Fail-closed rules

- A request without a resolvable organisation is denied.
- A caller cannot supply a different silo or subject and have it trusted.
- Runtime namespaces must be distinct from the trusted server namespace.
- A workload from another namespace, ServiceAccount, Job, Pod or attempt cannot bootstrap.
- Stale or unverifiable membership evidence cannot authorise a run.

The ClusterTenant custom resource provides the organisation binding used by the deployment.
It is not an execution resource and does not create user workloads.

## Operator check

Confirm that the release, public host and runtime profiles all resolve to the same organisation.
Then verify that the personal and managed runtime namespaces are separate from the server
namespace and from each other.

Source: [`libs/backend/server/tenancy/cluster-tenants/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/tenancy/cluster-tenants/main/README.md)
and [`apps/opencrane/src/app/routes.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/src/app/routes.ts).
