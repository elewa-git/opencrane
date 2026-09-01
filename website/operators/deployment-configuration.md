# Deployment configuration

**Deployment configuration** is the small set of umbrella-chart settings an operator chooses for a
ClusterTenant silo. App-specific values are forwarded to their owning charts and are not a second
platform configuration API.

> See also: [Hosting and deployment](/operators/hosting) for the install entrypoint,
> [DNS configuration](/operators/dns-config) for public hosts, and
> [Telemetry and logging](/operators/telemetry-logging) for trace collection.

## Use the deploy entrypoint

Start with the silo deploy command. It supplies the release-scoped database secrets, host, and OIDC
settings rather than asking you to repeat those values in a file.

```bash
apps/_infra/deploy-k8s/deploy.sh \
  --base-domain opencrane.example.com \
  --cluster-tenant acme \
  --acme-email operator@example.com \
  --postgres-credentials-secret opencrane-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap \
  --postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap
```

Use a values overlay for a repeatable environment choice. The deploy engine layers it over the chart
defaults and preserves existing release overrides on upgrades.

```bash
apps/_infra/deploy-k8s/deploy.sh ... \
  --values apps/_infra/deploy-k8s/platform/values/gcp-extras.yaml
```

## Umbrella inputs

These are the public configuration roots owned by the silo umbrella chart.

| Input | Use it for |
| --- | --- |
| `global` | Select the deployment environment and, only for private first-party images, a namespace-local registry pull Secret. |
| `multiCt` | Enable the explicit many-ClusterTenant profile and its required isolation floor. |
| `crds` | Decide whether this release installs the ClusterTenant custom resource definition. |
| `multiInstance` | Keep multiple independently named releases isolated in one cluster. |
| `sharedPlatform` | Deliberately use a verified shared LiteLLM or external-secret store. |
| `ingress` | Set the public domain, host, ingress class, annotations, and TLS reference. |
| `certManager` | Configure the release-owned issuer and ACME certificate behaviour. The silo entrypoint uses browser-trusted ACME HTTP-01 by default. |
| `networkPolicy` | Tune the release's default-deny and narrowly admitted network paths. |
| `externalSecrets` | Connect an External Secrets Operator store when that controller is already installed. |
| `observability` | Enable OpenTelemetry export and choose its logging detail. |
| `historyStore` | Configure the private KurrentDB event ledger, including immutable images and pre-created TLS, administrator, operations, and service credential Secrets. |
| `agentSandbox` | Configure release-scoped Sandbox profiles and their claim-admission contract; the cluster operator installs the controller and CRDs separately. |

::: warning
Do not copy a child chart's entire value tree into a platform overlay just because it appears in the
umbrella `values.yaml`. `channelProxy`, `agentController`, `clustertenantManager`, worker planes and
vendored services are forwarded to their app owners. Change them only with the app's documented
deployment contract and review their trust boundary first.
:::

## ConversationComputer substrate

`historyStore.kurrentdb` is disabled by default. Enable it only after supplying immutable KurrentDB
and bootstrap image digests plus existing TLS, administrator, operations, and HistoryStore-service
Secrets. The chart owns the namespaced ledger workload and its bootstrap boundary; it never creates
or rotates those credentials.

`agentSandbox` similarly creates only release-scoped `SandboxTemplate`, `SandboxWarmPool`, and
claim-admission resources. The Agent Sandbox controller and its `v1beta1` CRDs are cluster-wide
prerequisites. A profile must name the target namespace, verified RuntimeClass, zero-RBAC service
account, and immutable runtime image before a ConversationComputer may claim it.

## MCP image registry

OCI MCP admission needs one operator-owned OCI Distribution repository. The reserved
`registry.invalid` default is deliberately unusable; set the server's fixed HTTPS origin and
repository before accepting MCP image uploads.

```yaml
clustertenantManager:
  workflows:
    ociRegistry:
      baseUrl: https://registry.example.com
      repository: opencrane/mcp-images
      requestTimeoutMilliseconds: 30000
      authorization:
        existingSecret: opencrane-oci-registry-authorization
        secretKey: authorization
```

The optional Secret value is the complete HTTP `Authorization` header. OpenCrane mounts it as a
read-only file and re-reads it for each registry request, so rotation needs no server restart. The
client sends it only to the configured HTTPS origin, does not follow redirects, and stores accepted
images by digest rather than tag.

This repository currently stores admitted MCP images. It is not a product catalogue and it does not
grant access to an image. The central authorization authority targets MCP server and tool revisions;
Kubernetes receives the immutable registry reference only after admission.

→ [Governed packages and container images](/integrators/governed-packages) ·
[OCI MCP runtime](/integrators/oci-mcp-runtime)

## Keep the contract honest

The repository checks this page against the explicit configuration contract before a deploy workflow
can use it:

```bash
scripts/config-docs-coverage.sh --strict
```

When adding a new umbrella input, classify its top-level value as an operator input, a forwarded app
value, or an internal chart key. Operator inputs must name this page and appear in the table above.

Source: [`values.yaml`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/values.yaml),
[`config-docs-contract.json`](https://github.com/elewa-git/opencrane/blob/main/scripts/config-docs-contract.json),
[`server deployment template`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/helm/templates/_deployment.tpl),
and [`k8s-deploy.sh`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/platform/k8s-deploy.sh).
