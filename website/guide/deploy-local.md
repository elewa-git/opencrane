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
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap
```

The chart installs trusted services and distinct restricted namespaces for personal,
managed and worker Jobs. A single-node cluster does not collapse those boundaries. Create the
three PostgreSQL bootstrap Secrets in the target namespace first, using distinct credentials.

::: warning
Single-node does not mean single namespace. OpenCrane refuses a deployment that places
untrusted runtime Jobs beside the trusted server.
:::

## Next

→ [Set up your domain](/guide/dns) → [Create your first agent](/guide/first-agent)
