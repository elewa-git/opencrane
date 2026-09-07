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

Use the [deployment configuration](/operators/deployment-configuration#use-the-deploy-entrypoint)
for the app-owned command and its required identity, first-owner and immutable-image inputs.
The chart composes the server, UI and supporting services. Cluster-wide controllers remain
external prerequisites. Create the three PostgreSQL bootstrap Secrets in the target namespace
before running the script; each must hold distinct credentials.

The [conversation execution profile](/operators/deployment-configuration#conversation-execution-profile)
also enables KurrentDB and Agent Sandbox. These are disabled in generic defaults. The current
wrapper supplies their checked configuration for `testv5`; another tenant needs an explicitly
reviewed profile. A successful base installation does not prove that conversation execution works.

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
