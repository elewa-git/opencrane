# Hosting and deployment

OpenCrane installs as one **organisation silo** on a conformant Kubernetes cluster. The
umbrella chart composes the trusted services, separate warm runtime pools and restricted worker
namespaces.

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
    ├── personal runtime namespace
    │   └── fixed warm Deployment; one claimed Pod per admitted attempt
    ├── managed runtime namespace
    │   └── fixed warm Deployment; one claimed Pod per managed attempt
    └── restricted worker namespaces
        ├── skill authoring
        ├── MCP executor
        └── artifact preprocessor
```

Each runtime namespace has one Helm-owned warm Deployment. Its generic Pods have no attempt data or
authority. After OpenCrane durably admits a run, the controller claims one exact Pod UID, activates
the fixed personal or managed network profile, and deletes that Pod when the attempt ends. The
Deployment creates the replacement spare.

## Prerequisites

- Kubernetes 1.30 or newer for the stable validating-admission boundary.
- A default StorageClass.
- A CNI that enforces `NetworkPolicy`.
- Ingress, DNS and certificate controllers when exposing a public host.
- PostgreSQL credentials supplied through Kubernetes Secrets.
- Immutable image digests for the controller and runtime.

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
Do not deploy the personal and managed runtimes into the trusted server namespace. The server
validates that all three namespaces are distinct and refuses to start on a collapsed boundary.
:::

## What the release owns

| Surface | Ownership |
|---|---|
| Trusted applications | App-owned chart templates composed by the umbrella |
| Runtime Jobs | Created and conditionally released by `agent-controller` |
| Runtime namespace floor | Pod Security Standards, quota, default-deny policy and admission policy |
| Run authority | PostgreSQL-backed OpenCrane server |
| Cluster-wide controllers | External prerequisites, not installed as silo business workloads |

Source: [`apps/_infra/deploy-k8s`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/README.md)
and [`apps/agent-controller`](https://github.com/elewa-git/opencrane/blob/main/apps/agent-controller/README.md).
