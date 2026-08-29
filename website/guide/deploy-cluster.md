# Cluster deployment

Run OpenCrane on any **conformant Kubernetes cluster** with the storage, networking and
admission features required by the silo chart.

## Cluster requirements

| Requirement | Why it matters |
|---|---|
| Kubernetes 1.30+ | Stable validating-admission policy for warm runtime Pod claims and worker Jobs |
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
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
  --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap
```

The `opencrane-silo` chart composes the trusted control plane, supporting services,
agent controller, warm runtime pools and separate restricted worker namespaces. Cluster-wide controllers remain
external prerequisites. Create the three named PostgreSQL bootstrap Secrets in the target
namespace before running the script; each must hold distinct credentials.

Point `<cluster-tenant>.<base-domain>` at the ingress address before deploying. The entrypoint
uses Let's Encrypt HTTP-01 to obtain the browser-trusted certificate.

## Validate the boundary

After installation:

1. check that the trusted, personal-runtime and managed-runtime namespaces are distinct;
2. inspect their Pod Security labels, quotas and default-deny policies;
3. confirm the personal and managed warm Deployments use the fixed generic profiles;
4. confirm the controller and runtime images use immutable digests; and
5. start one run, verify it claims one exact Pod UID, and verify that UID is deleted afterwards.

::: tip
Managed Kubernetes services are hosting choices, not different OpenCrane architectures.
Keep provider-specific identity and storage configuration outside the runtime authority.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)

Changing OpenCrane itself rather than installing it? See
[Contributing → Deploying](/contributing/deploying) for the CI-to-cluster pipeline this script
sits behind.
