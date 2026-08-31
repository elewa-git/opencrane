# Networking and isolation

OpenCrane keeps the public API, trusted services and untrusted runtime Pods on **separate
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

claimed runtime Pod
  │ projected identity + one-use bootstrap + outbound stream
  ▼
OpenCrane internal runtime API
  │
  ├──► model routing
  ├──► governed tool custody
  └──► memory and artifact services
```

There is no public route, Service or Ingress for an individual runtime Pod. A Pod also has no
Kubernetes RBAC, provider credential or unrestricted east-west access.

## Namespace policy

| Namespace class | Ingress | Egress |
|---|---|---|
| Trusted server | public traffic through Ingress; explicit same-silo service callers | database, same-silo services and declared external dependencies |
| Generic warm runtime | none | DNS and same-silo OpenCrane only |
| Claimed personal or managed runtime | fixed controller binding port | DNS, same-silo OpenCrane and LiteLLM only |
| Worker namespaces | none | only the exact broker or service required by that job class |

The chart also applies aggregate Job, Pod, CPU and memory quotas. Admission rejects sidecars,
host access, privileged containers, durable mounts, unpinned images and arbitrary Secret
projections.

## Runtime authentication

Network reachability is not authority. OpenCrane separately verifies the projected token
audience, namespace, ServiceAccount, reserved Pod UID, run, attempt and agent revision.
A one-use bootstrap binds the runtime's proof key before the command stream is admitted.

::: tip
Treat `NetworkPolicy` as the portable L3/L4 floor and workload proof as the application
boundary. Both must pass.
:::

::: warning
A Cilium-based dataplane does not prove that the cluster serves `CiliumNetworkPolicy`. GKE
Dataplane V2 enforces standard `NetworkPolicy` but does not expose that namespaced custom policy
kind. Use Cilium-specific resources only after confirming the exact API and its enforcement
controller; do not install a CRD by itself.
:::

## Operator checks

1. Confirm the CNI enforces `NetworkPolicy`.
2. If the render contains a custom policy kind, confirm that exact API and controller are live.
3. Confirm the trusted, personal-runtime and managed-runtime namespaces are distinct.
4. Render the chart and inspect the runtime admission policies and quotas.
5. Verify runtime Pods have no Service, Ingress, role binding or persistent volume.
6. Verify only the ingress controller can reach the public API port.

Source: [`apps/opencrane/helm/templates/_networkpolicy.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_networkpolicy.tpl),
[`apps/agent-controller/helm/templates/_warm-runtime.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-controller/helm/templates/_warm-runtime.tpl),
and [`libs/backend/agents/runtime/k8s-launcher`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/runtime/k8s-launcher/README.md).
