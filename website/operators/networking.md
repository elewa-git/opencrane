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

conversation-computer Pod
  │ projected identity + bootstrap status and model-step request
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
| Conversation computer | OpenCrane server to private review port only | DNS and same-silo OpenCrane private API only |
| Worker namespaces | none | only the exact broker or service required by that job class |

The chart also applies aggregate Job, Pod, CPU and memory quotas. Admission rejects sidecars,
host access, privileged containers, durable mounts, unpinned images and arbitrary Secret
projections.

## Runtime authentication

Network reachability is not authority. OpenCrane separately verifies the projected token
audience, namespace, ServiceAccount, Pod UID, computer id, lease id and generation.
The current text model-step bootstrap returns only a turn id and status. The server keeps compiled
prompts and attempt-scoped model credentials, and appends accepted output itself. The computer has
no direct LiteLLM egress allowance; LiteLLM ingress admits the same-release server and Cognee.
These replacement policies are source under review and are not yet deployed on testv5.

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
3. Confirm the claim policy accepts only this release's OpenCrane ServiceAccount.
4. Render the chart and inspect the Agent Sandbox template, claim policy and resource limits.
5. Verify the generated Service is private and the Pod has no Ingress, mutation RBAC or persistent volume.
6. Verify only the ingress controller can reach the public API port.
7. Verify the computer can reach the private server and cannot connect directly to LiteLLM.

Source: [`apps/opencrane/helm/templates/_networkpolicy.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_networkpolicy.tpl),
[`apps/_infra/agent-sandbox/helm/templates/_resources.tpl`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/helm/templates/_resources.tpl),
and [`apps/conversation-computer`](https://github.com/elewa-git/opencrane/blob/main/apps/conversation-computer/README.md).
