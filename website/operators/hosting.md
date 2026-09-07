# Hosting and deployment

OpenCrane installs as one **organisation silo** on a conformant Kubernetes cluster. The
umbrella chart composes the trusted services, KurrentDB conversation history, an Agent Sandbox
computer profile and restricted worker namespaces.

> See also: [Deployment configuration](/operators/deployment-configuration) (public Helm inputs),
> [Organisation boundary](/operators/organisation-boundary) (what one silo serves),
> [Networking and isolation](/operators/networking) (allowed traffic),
> [Runbook](/operators/runbook) (health and recovery), and
> [Deploying](/contributing/deploying) (the script chain and CI gates behind a release).

## Deployment shape

```text
Kubernetes cluster
└── OpenCrane silo for one ClusterTenant
    ├── trusted namespace
    │   ├── OpenCrane server and UI
    │   ├── agent controller
    │   └── supporting services
    ├── KurrentDB
    │   └── ordered conversation and computer history
    ├── Agent Sandbox profile
    │   └── one claimed conversation-computer Pod per active lease
    └── restricted worker namespaces
        ├── skill authoring
        ├── MCP executor
        └── artifact preprocessor
```

An enabled computer profile renders a `SandboxTemplate` and its configured `SandboxWarmPool`. After a
conversation entry requests activation, OpenCrane records the computer generation and lease in
KurrentDB and creates one checked `SandboxClaim`. The external Agent Sandbox controller realises the
Pod and Service; OpenCrane does not run a second Pod lifecycle controller.

## Prerequisites

- Kubernetes 1.30 or newer for the stable validating-admission boundary.
- A default StorageClass.
- A CNI that enforces `NetworkPolicy`.
- Ingress, DNS and certificate controllers when exposing a public host.
- PostgreSQL credentials supplied through Kubernetes Secrets.
- KurrentDB TLS and least-privilege service credentials.
- Agent Sandbox v1beta1 CRDs and controller with extensions enabled.
- An approved `gvisor` RuntimeClass.
- Immutable image digests for KurrentDB, its bootstrap image and the conversation computer.

## Operator inputs

Provide the target Kubernetes context, organisation name and domain, OIDC client configuration,
first-owner and certificate-contact emails, three distinct PostgreSQL bootstrap Secrets, and the
published image references. Conversation execution also needs the history and sandbox configuration
listed in [deployment configuration](/operators/deployment-configuration). The script derives the
namespace and default OIDC callback. Add a registry pull Secret when images are private.

::: warning
Do not put OIDC or registry secret bytes in Helm values, committed files, or shell history.
:::

## Install

Use the single command template in
[deployment configuration](/operators/deployment-configuration#use-the-deploy-entrypoint).

The script delegates to `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` and installs the
`opencrane-silo` umbrella chart. It does not install a second management plane. The three
PostgreSQL bootstrap Secrets must already exist in the target namespace and use distinct
credentials.

KurrentDB and Agent Sandbox are disabled in generic chart defaults. The current wrapper enables
and validates them for `testv5`; other organisation names need an explicitly reviewed values profile
and the same prerequisites. The diagram above describes the conversation-capable composition,
not what an unconfigured base chart can do.

The public host must already resolve to the ingress address. The entrypoint uses Let's Encrypt
HTTP-01 and needs `--acme-email`; it fails before applying a self-signed certificate.

::: warning
Do not bypass `deploy.sh` by creating claims or Pods manually. The testv5 preflight verifies the
Agent Sandbox APIs, controller, RuntimeClass, immutable images and KurrentDB Secrets before Helm
changes the silo.
:::

## What the release owns

| Surface | Ownership |
|---|---|
| Trusted applications | App-owned chart templates composed by the umbrella |
| Conversation computers | Reconciled from checked claims by the external Agent Sandbox controller |
| Computer profile floor | gVisor, restricted security context, bounded scratch, default-deny policy and admission policy |
| Conversation history | KurrentDB-backed OpenCrane server |
| Product authorization | PostgreSQL-backed OpenCrane server |
| Cluster-wide controllers | External prerequisites, not installed as silo business workloads |

Source: [`apps/_infra/deploy-k8s`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/README.md)
and [`apps/_infra/agent-sandbox`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/README.md).
