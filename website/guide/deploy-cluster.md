# Cluster deployment

Run OpenCrane on any **conformant Kubernetes cluster** with the storage, networking and
admission features required by the silo chart.

## Cluster requirements

| Requirement | Why it matters |
|---|---|
| Kubernetes 1.30+ | Stable validating-admission policy for Agent Sandbox claims and worker Jobs |
| Default StorageClass | Persistent trusted services |
| NetworkPolicy-enforcing CNI | Deny-by-default namespace floor |
| Reachable image registry | Immutable controller and runtime images |
| Ingress and certificate management | Public UI and API host |
| PostgreSQL | Canonical product policy and audit authority |
| KurrentDB | Ordered conversation and computer history |
| Agent Sandbox v1beta1 + gVisor | Reconciled, isolated conversation-computer Pods |

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
agent controller, KurrentDB, an Agent Sandbox computer profile and separate restricted worker namespaces. Cluster-wide controllers remain
external prerequisites. Create the three named PostgreSQL bootstrap Secrets in the target
namespace before running the script; each must hold distinct credentials.

Point `<cluster-tenant>.<base-domain>` at the ingress address before deploying. The entrypoint
uses Let's Encrypt HTTP-01 to obtain the browser-trusted certificate.

## Validate the boundary

After installation:

1. verify the KurrentDB TLS and `opencrane-history` service Secrets are immutable;
2. verify all four Agent Sandbox CRDs serve and store `v1beta1`;
3. confirm the controller runs with extensions enabled and the `gvisor` RuntimeClass exists;
4. confirm KurrentDB, bootstrap and conversation-computer images use immutable digests; and
5. post one message, verify one generation-bound claim and Pod, then verify the assistant entry lands in KurrentDB.

::: tip
Managed Kubernetes services are hosting choices, not different OpenCrane architectures.
Keep provider-specific identity and storage configuration outside the runtime authority.
:::

## Next

→ [Set up your domain](/guide/dns) → [Set up your personal assistant](/guide/persona)

Changing OpenCrane itself rather than installing it? See
[Contributing → Deploying](/contributing/deploying) for the CI-to-cluster pipeline this script
sits behind.
