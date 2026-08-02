# Hosting and deployment

OpenCrane installs as one **organisation silo** on a conformant Kubernetes cluster. The
umbrella chart composes the trusted services and separate, restricted Job namespaces.

> See also: [Deployment configuration](/operators/deployment-configuration) (public Helm inputs),
> [Organisation boundary](/operators/organisation-boundary) (what one silo serves),
> [Networking and isolation](/operators/networking) (allowed traffic), and
> [Runbook](/operators/runbook) (health and recovery).

## Deployment shape

```text
Kubernetes cluster
└── OpenCrane silo for one ClusterTenant
    ├── trusted namespace
    │   ├── OpenCrane server and UI
    │   ├── agent controller
    │   └── supporting services
    ├── personal runtime namespace
    │   └── fresh Job per admitted attempt
    ├── managed runtime namespace
    │   └── fresh Job per scheduled or managed attempt
    └── restricted worker namespaces
        ├── skill authoring
        ├── tool runner
        └── artifact preprocessor
```

The runtime image is not a long-lived Deployment. The controller creates a suspended Job
only after OpenCrane has durably admitted the run, then releases that exact Kubernetes UID.

## Prerequisites

- Kubernetes 1.30 or newer for the stable validating-admission boundary.
- A default StorageClass.
- A CNI that enforces `NetworkPolicy`.
- Ingress, DNS and certificate controllers when exposing a public host.
- PostgreSQL credentials supplied through Kubernetes Secrets.
- Immutable image digests for the controller and runtime.

## Install

Use the app-owned entrypoint:

```bash
export OIDC_ISSUER_URL=https://identity.example.com
export OIDC_CLIENT_ID=<organisation-client-id>

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example.com \
  --cluster-tenant acme \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap
```

The script delegates to `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` and installs the
`opencrane-silo` umbrella chart. It does not install a second management plane. The three
PostgreSQL bootstrap Secrets must already exist in the target namespace and use distinct
credentials.

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

Source: [`apps/_infra/deploy-k8s`](https://github.com/italanta/opencrane/blob/main/apps/_infra/deploy-k8s/README.md)
and [`apps/agent-controller`](https://github.com/italanta/opencrane/blob/main/apps/agent-controller/README.md).
