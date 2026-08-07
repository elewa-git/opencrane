# Networking and isolation

OpenCrane keeps the public API, trusted services and untrusted runtime Jobs on **separate
network surfaces**. Every runtime connection is outbound and every namespace starts deny-by-default.

> See also: [Hosting and deployment](/operators/hosting) (namespace layout),
> [Organisation boundary](/operators/organisation-boundary) (silo scope), and
> [Identity and network isolation](/operators/cilium-spiffe-identity) (identity-keyed policy).

## Traffic shape

```text
browser
  │ HTTPS + OIDC session
  ▼
Ingress ──► OpenCrane public API

runtime Job
  │ projected identity + one-use bootstrap + outbound stream
  ▼
OpenCrane internal runtime API
  │
  ├──► model routing
  ├──► governed tool custody
  └──► memory and artifact services
```

There is no public route, Service or Ingress for an individual runtime Job. A Job also has no
Kubernetes RBAC, provider credential or unrestricted east-west access.

## Namespace policy

| Namespace class | Ingress | Egress |
|---|---|---|
| Trusted server | public traffic through Ingress; explicit same-silo service callers | database, same-silo services and declared external dependencies |
| Personal runtime | none | DNS, same-silo OpenCrane and LiteLLM only |
| Managed runtime | none | DNS and explicitly declared same-silo agent services |
| Worker namespaces | none | only the exact broker or service required by that job class |

The chart also applies aggregate Job, Pod, CPU and memory quotas. Admission rejects sidecars,
host access, privileged containers, durable mounts, unpinned images and arbitrary Secret
projections.

## Runtime authentication

Network reachability is not authority. OpenCrane separately verifies the projected token
audience, namespace, ServiceAccount, Job UID, first-Pod UID, run, attempt and agent revision.
A one-use bootstrap binds the runtime's proof key before the command stream is admitted.

::: tip
Treat `NetworkPolicy` as the portable L3/L4 floor and workload proof as the application
boundary. Both must pass.
:::

## Operator checks

1. Confirm the CNI enforces `NetworkPolicy`.
2. Confirm the trusted, personal-runtime and managed-runtime namespaces are distinct.
3. Render the chart and inspect the runtime admission policies and quotas.
4. Verify runtime Jobs have no Service, Ingress, role binding or persistent volume.
5. Verify only the ingress controller can reach the public API port.

Source: [`apps/opencrane/helm/templates/_networkpolicy.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_networkpolicy.tpl)
and [`libs/backend/agents/runtime/k8s-launcher`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/runtime/k8s-launcher/README.md).
