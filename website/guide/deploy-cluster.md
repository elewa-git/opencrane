# Cluster deployment

Run OpenCrane on any **conformant Kubernetes cluster** with the storage, networking and
admission features required by the silo chart.

## Cluster requirements

| Requirement | Why it matters |
|---|---|
| Kubernetes 1.30+ | Stable validating-admission policy for runtime Jobs |
| Default StorageClass | Persistent trusted services |
| NetworkPolicy-enforcing CNI | Deny-by-default namespace floor |
| Reachable image registry | Immutable controller and runtime images |
| Ingress and certificate management | Public UI and API host |
| PostgreSQL | Canonical run, policy and audit authority |

## Deploy one organisation silo

```bash
export OIDC_ISSUER_URL=https://identity.example.com
export OIDC_CLIENT_ID=<organisation-client-id>

apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example.com \
  --cluster-tenant acme \
  --acme-email operator@example.com \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap
```

The `opencrane-silo` chart composes the trusted control plane, supporting services,
agent controller and separate restricted Job namespaces. Cluster-wide controllers remain
external prerequisites. Create the three named PostgreSQL bootstrap Secrets in the target
namespace before running the script; each must hold distinct credentials.

Point `<cluster-tenant>.<base-domain>` at the ingress address before deploying. The entrypoint
uses Let's Encrypt HTTP-01 to obtain the browser-trusted certificate.

## Validate the boundary

After installation:

1. check that the trusted, personal-runtime and managed-runtime namespaces are distinct;
2. inspect their Pod Security labels, quotas and default-deny policies;
3. confirm the runtime image is absent from long-lived Deployments;
4. confirm the controller and runtime images use immutable digests; and
5. start one run and verify it receives a fresh Job assignment.

::: tip
Managed Kubernetes services are hosting choices, not different OpenCrane architectures.
Keep provider-specific identity and storage configuration outside the runtime authority.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)
