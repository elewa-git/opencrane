# Local, VM or VPS

Run one **OpenCrane organisation silo** on a small Kubernetes cluster. This is suitable
for evaluation and single-node environments where control-plane downtime is acceptable.

## Prerequisites

- Kubernetes 1.30 or newer.
- A default StorageClass.
- An ingress controller if you need browser access.
- A CNI that enforces `NetworkPolicy`.
- PostgreSQL Secrets required by the deployment profile.
- KurrentDB, Agent Sandbox v1beta1 and gVisor prerequisites for the 0.11 conversation path.

## Install the silo

Use the same app-owned entrypoint as a production cluster:

```bash
export OIDC_ISSUER_URL=https://identity.example.com
export OIDC_CLIENT_ID=<organisation-client-id>

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain <your-domain> \
  --cluster-tenant <org-name> \
  --acme-email operator@example.com \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
  --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap
```

The chart installs trusted services, KurrentDB, one release-owned Agent Sandbox computer profile,
and restricted worker Job namespaces. Create the three PostgreSQL bootstrap Secrets in the target
namespace first, using distinct credentials. The testv5 profile also requires the immutable KurrentDB
Secrets and image digests, an extensions-enabled Agent Sandbox controller and a `gvisor` RuntimeClass.

Point the public host at the ingress address before installing so Let's Encrypt HTTP-01 can issue the
browser-trusted certificate. Add `--verify` when you want an advisory check of pod readiness,
hostname resolution, and the public server/database health endpoint after installation. These checks
report diagnostics without turning a completed installation into a failed release.

::: warning
Single-node does not remove the sandbox boundary. Do not substitute an ordinary Pod runtime for the
required `gvisor` RuntimeClass or expose a conversation computer outside the silo.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)
