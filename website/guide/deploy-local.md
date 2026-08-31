# Local, VM or VPS

Run one **OpenCrane organisation silo** on a small Kubernetes cluster. This is suitable
for evaluation and single-node environments where control-plane downtime is acceptable.

## Prerequisites

- Kubernetes 1.30 or newer.
- A default StorageClass.
- An ingress controller if you need browser access.
- A CNI that enforces `NetworkPolicy`.
- PostgreSQL Secrets required by the deployment profile.

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

The chart installs trusted services, distinct personal and managed warm runtime namespaces, and
restricted worker Job namespaces. A single-node cluster does not collapse those boundaries. Create the
three PostgreSQL bootstrap Secrets in the target namespace first, using distinct credentials.

Point the public host at the ingress address before installing so Let's Encrypt HTTP-01 can issue the
browser-trusted certificate. Add `--verify` when you want an advisory check of pod readiness,
hostname resolution, and the public server/database health endpoint after installation. These checks
report diagnostics without turning a completed installation into a failed release.

::: warning
Single-node does not mean single namespace. OpenCrane refuses a deployment that places
untrusted runtime Pods beside the trusted server.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)
