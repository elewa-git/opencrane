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
  --obot-postgres-credentials-secret opencrane-obot-postgres-bootstrap \
  --litellm-postgres-credentials-secret opencrane-litellm-postgres-bootstrap
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
| `sharedPlatform` | Deliberately use a verified shared LiteLLM, MCP gateway, or external-secret store. |
| `ingress` | Set the public domain, host, ingress class, annotations, and TLS reference. |
| `certManager` | Configure the release-owned issuer and ACME certificate behaviour. The silo entrypoint uses browser-trusted ACME HTTP-01 by default. |
| `networkPolicy` | Tune the release's default-deny and narrowly admitted network paths. |
| `externalSecrets` | Connect an External Secrets Operator store when that controller is already installed. |
| `observability` | Enable OpenTelemetry export and choose its logging detail. |

::: warning
Do not copy a child chart's entire value tree into a platform overlay just because it appears in the
umbrella `values.yaml`. `channelProxy`, `agentController`, `clustertenantManager`, worker planes and
vendored services are forwarded to their app owners. Change them only with the app's documented
deployment contract and review their trust boundary first.
:::

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
and [`k8s-deploy.sh`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/platform/k8s-deploy.sh).
