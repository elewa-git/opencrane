# Deployment configuration

**Deployment configuration** is the small set of umbrella-chart settings an operator chooses for a
ClusterTenant silo. App-specific values are forwarded to their owning charts and are not a second
platform configuration API.

> See also: [Hosting and deployment](/operators/hosting) for the install entrypoint,
> [DNS configuration](/operators/dns-config) for public hosts, and
> [Telemetry and logging](/operators/telemetry-logging) for trace collection.

## Use the deploy entrypoint

Use the app-owned deploy command. Populate these variables from your target configuration and
published build output; the example does not invent a usable image digest or credential. Supply
`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID` and the confidential-client secret through your approved secret
process before running it. The first-owner email must match a verified sign-in email.

```bash
apps/_infra/deploy-k8s/deploy.sh \
  --base-domain "$OPENCRANE_BASE_DOMAIN" \
  --cluster-tenant "$OPENCRANE_CLUSTER_TENANT" \
  --acme-email "$OPENCRANE_ACME_EMAIL" \
  --first-user-email "$OPENCRANE_FIRST_USER_EMAIL" \
  --image-tag "$OPENCRANE_BUILD_TAG" \
  --opencrane-ui-digest "$OPENCRANE_UI_DIGEST" \
  --cognee-digest "$OPENCRANE_COGNEE_DIGEST" \
  --postgres-credentials-secret "$OPENCRANE_POSTGRES_SECRET" \
  --litellm-postgres-credentials-secret "$OPENCRANE_LITELLM_POSTGRES_SECRET" \
  --postgres-admin-credentials-secret "$OPENCRANE_POSTGRES_ADMIN_SECRET" \
  --values "$OPENCRANE_VALUES_FILE"
```

The build tag must identify a published `sha-*` build. Image digests must be exact `sha256:`
references; named database Secrets must already exist and use distinct credentials. Use a values
overlay for repeatable environment choices. The deploy engine layers it over chart defaults and
preserves existing release overrides on ordinary application updates.

## Conversation execution profile

Generic defaults disable `historyStore.kurrentdb` and `agentSandbox`. The current wrapper enables
and checks the conversation profile for the named `testv5` target. Other tenant names require an
explicitly reviewed values profile and the same prerequisites; do not rename a real tenant to
select development defaults.

For `testv5`, the wrapper reads these additional environment variables (equivalent CLI flags are
listed in the source). Store the non-secret configuration in your environment profile and supply
only Secret names here:

| Inputs | Variables |
|---|---|
| History image | `OPENCRANE_KURRENTDB_IMAGE_DIGEST` |
| History Secrets | `OPENCRANE_KURRENTDB_TLS_SECRET`, `OPENCRANE_KURRENTDB_BOOTSTRAP_ADMIN_SECRET`, `OPENCRANE_KURRENTDB_BOOTSTRAP_OPS_SECRET`, `OPENCRANE_KURRENTDB_SERVICE_CREDENTIAL_SECRET` |
| Bootstrap image | `OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_REPOSITORY`, `OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_DIGEST`, `OPENCRANE_KURRENTDB_BOOTSTRAP_IMAGE_PULL_POLICY` |
| Bootstrap resources | `OPENCRANE_KURRENTDB_BOOTSTRAP_CPU_REQUEST`, `OPENCRANE_KURRENTDB_BOOTSTRAP_MEMORY_REQUEST`, `OPENCRANE_KURRENTDB_BOOTSTRAP_CPU_LIMIT`, `OPENCRANE_KURRENTDB_BOOTSTRAP_MEMORY_LIMIT` |
| Bootstrap timing | `OPENCRANE_KURRENTDB_BOOTSTRAP_ACTIVE_DEADLINE_SECONDS`, `OPENCRANE_KURRENTDB_BOOTSTRAP_BACKOFF_LIMIT`, `OPENCRANE_KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS` |
| Computer image | `OPENCRANE_AGENT_SANDBOX_IMAGE_DIGEST`, `OPENCRANE_AGENT_SANDBOX_IMAGE_PULL_POLICY`; `OPENCRANE_AGENT_SANDBOX_IMAGE_REPOSITORY` may override the default repository |

The target must already have immutable history Secrets, all four Agent Sandbox CRDs serving and
storing `v1beta1`, a ready controller with extensions enabled and an approved `gvisor` RuntimeClass.
The [runbook](/operators/runbook) covers recovery; [development status](/guide/status) distinguishes
this installation machinery from live qualification.

Source: [`deploy.sh`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/deploy.sh).

## GKE snapshot prerequisite

Before selecting KurrentDB `volumeSnapshot` backups, prepare one snapshot class through the deploy
entrypoint. This separate action needs the existing GKE Persistent Disk driver and snapshot API;
it does not install a silo or require identity-provider credentials.

```bash
apps/_infra/deploy-k8s/platform/k8s-deploy.sh \
  --provision-gke-snapshot-class opencrane-pd-snapshots \
  --context "$OPENCRANE_KUBERNETES_CONTEXT" \
  --storage-class standard-rwo
```

The action flag comes first. The current context must match the explicit target, and the selected
StorageClass must use `pd.csi.storage.gke.io`. The action creates one OpenCrane-owned, non-default
class with `Delete` policy, or verifies an existing exact match. It refuses foreign classes,
different drivers or retention settings, and default-class annotations without changing them.
`Delete` lets scheduled retention remove the cloud snapshot when its Kubernetes object is pruned;
the separately labelled pre-restore safety snapshots remain outside scheduled pruning.

In the silo values profile, set `historyStore.kurrentdb.backup.mode` to `volumeSnapshot` and
`historyStore.kurrentdb.backup.volumeSnapshot.className` to `opencrane-pd-snapshots`. Supply the
snapshot Job's published image repository and immutable digest under
`historyStore.kurrentdb.backup.volumeSnapshot.image`. Provision the ledger's data volume through
the same CSI driver, such as `standard-rwo`. The deploy engine supplies the bounded Kubernetes API
network paths. Class creation alone does not prove a backup or restore: complete the
[recovery drill](/operators/runbook) before recording it as qualified.

## Conversation live updates

The existing public API serves same-origin browser events. Keep the ordinary authenticated API
route available; there is no additional channel service, public KurrentDB endpoint or routing
registry to deploy. The response asks proxies to avoid buffering so new messages can arrive
promptly.

Each connection ends after 60 seconds, or 30 seconds without a new stream revision, including
cursor-only updates for entries hidden from that participant. A heartbeat runs
every 10 seconds; the browser reconnects using its last revision. A connection sends at most
128 history frames or 2 MiB, with a 512 KiB frame limit. A larger backlog resumes on another
connection.

One listener process admits at most two simultaneous streams and twelve starts per minute for
each authenticated silo/subject, plus 128 simultaneous streams across that process. An overloaded
client receives HTTP 429 and a retry delay. These are process-local limits: adding replicas
multiplies aggregate capacity. They are fixed application defaults, not additional chart inputs.
Current membership and conversation permissions are rechecked during delivery; a saved cursor
cannot grant access or select a different stream.

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

::: warning
Do not copy a child chart's entire value tree into a platform overlay just because it appears in the
umbrella `values.yaml`. `agentController`, `clustertenantManager`, worker planes and
vendored services are forwarded to their app owners. Change them only with the app's documented
deployment contract and review their trust boundary first.
:::

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
