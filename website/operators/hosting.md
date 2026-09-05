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

The release renders one immutable `SandboxTemplate` and one zero-replica `SandboxWarmPool`. After a
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

## Minimal operator handoff

Provide the target Kubernetes context, ClusterTenant and base domain; OIDC issuer, client ID and
confidential-client secret; the first operator email or IdP group mapping; and three distinct
PostgreSQL bootstrap credential Secrets. Add a namespace-local registry pull Secret only for private
images. The script derives the namespace and default OIDC callback, and creates the OIDC Secret.

::: warning
Do not put OIDC or registry secret bytes in Helm values, committed files, or shell history.
:::

## Install

Use the app-owned entrypoint:

```bash
export OIDC_ISSUER_URL=https://identity.example.com
export OIDC_CLIENT_ID=<organisation-client-id>
export OPENCRANE_OIDC_CLIENT_SECRET=<secret-manager-value>
export OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL=operator@example.com

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example.com \
  --cluster-tenant acme \
  --acme-email operator@example.com \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
  --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap
# Add --registry-pull-secret opencrane-ghcr-pull for private images.
```

The script delegates to `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` and installs the
`opencrane-silo` umbrella chart. It does not install a second management plane. The three
PostgreSQL bootstrap Secrets must already exist in the target namespace and use distinct
credentials.

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
