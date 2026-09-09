# Deployment configuration

**Deployment configuration** is the small set of umbrella-chart settings an operator chooses for a
ClusterTenant silo. App-specific values are forwarded to their owning charts and are not a second
platform configuration API.

> See also: [Hosting and deployment](/operators/hosting) for the install entrypoint,
> [DNS configuration](/operators/dns-config) for public hosts, and
> [Telemetry and logging](/operators/telemetry-logging) for trace collection.

## Prepare database credentials

For a fresh silo, choose its namespace and release name, confirm the intended Kubernetes context,
then generate its PostgreSQL and KurrentDB credentials through the deploy entrypoint:

```bash
set -euo pipefail
test "$(kubectl config current-context)" = "$OPENCRANE_KUBERNETES_CONTEXT"
apps/_infra/deploy-k8s/platform/k8s-deploy.sh --provision-postgres-bootstrap-secrets \
  --namespace "$OPENCRANE_NAMESPACE" --release "$OPENCRANE_RELEASE"
apps/_infra/deploy-k8s/platform/k8s-deploy.sh --provision-kurrentdb-bootstrap-secrets \
  --namespace "$OPENCRANE_NAMESPACE" --release "$OPENCRANE_RELEASE"
```

Each action comes first, creates the namespace if needed, and exits after credential preparation.
Retries validate existing credentials without rotating them. PostgreSQL gets separate application,
LiteLLM and administrator credentials; KurrentDB also gets immutable TLS trust and service
credentials. Pass their generated Secret names into the install profile. Ordinary installation
validates these inputs and does not invoke either provisioning action automatically.

## Preserve browser login during server replacement

The session-storage follow-up uses the existing PostgreSQL database to share encrypted login state.
Keep the same randomly generated `OIDC_SESSION_SECRET` on every server and across replacement;
it must contain at least 32 bytes. Replacing it signs everyone out. The server will not start OIDC
without persistent session storage, and database failures do not fall back to process memory.

`OIDC_SESSION_MAX_AGE_SECONDS` defaults to 12 hours and allows at most seven days. Each new session
keeps its original deadline, even if that setting changes later. Verified identity-token expiry
may end it sooner. An anonymous sign-in flow expires after ten minutes; reauthentication while signed in remains
bounded by the existing identity expiry. Logout clears stored secrets and
keeps a small marker until delayed requests can no longer revive the session; active servers remove
expired markers in bounded batches.

This change adds a technical session table and requires a fresh installation from the matching
baseline. Its source and CI evidence remain separate from the existing testv5 deployment. See
[development status](/guide/status) and [identity](/security/identity).

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
overlay for the fresh installation. On later application updates, omit `--values`: the deploy
engine preserves the release's existing overrides. Supply individual configuration changes with
the supported flags or `--set-string`. Once a standalone first owner is configured, the installer
rejects `--values` and `--reset-values` to preserve its immutable email, issuer and silo binding.
Continue supplying the same first-owner and OIDC coordinates.

## Membership mode

Set `clustertenantManager.membership.mode` explicitly. A `standalone` installation admits its first
owner and invited members through local PostgreSQL membership. `fleet` requires its configured
issuer and mounted verification key; a missing or invalid Fleet proof never becomes local access.
The [membership guide](/integrators/silo-iam#membership-in-an-installation) explains how the selected
evidence constrains assistant runs.

`clustertenantManager.membership.maximumStalenessMs` bounds evidence lifetime. Its default is
300,000 milliseconds; the server requires a positive integer of at most 86,400,000 milliseconds.
The chart supplies the installation ID and sign-in issuer used for standalone checks. Preserve those
identity settings across ordinary repairs. A shorter evidence lifetime does not replace current
membership and permission checks, and refreshing evidence cannot extend an already admitted run.

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
storing `v1beta1`, a ready controller with extensions enabled and the `opencrane.ai` Pod-label
domain configured, and an approved `gvisor` RuntimeClass. The [hosting guide](/operators/hosting)
shows the controller prerequisite command.
The [runbook](/operators/runbook) covers recovery; [development status](/guide/status) distinguishes
this installation machinery from live qualification.

When the cluster uses a node-local DNS resolver, set `historyStore.kurrentdb.dnsResolverCidrs`
to the resolver addresses used by its Pods, each as an IPv4 `/32` or IPv6 `/128` host CIDR.
Bootstrap and snapshot Jobs then allow UDP and TCP port 53 to those exact addresses alongside
the ordinary `kube-dns` Pod selector. The default list is empty; the `opencrane-dev` values
profile supplies its verified node-local resolver. This does not add network access to the
KurrentDB node or file-copy backups.

Source: [`deploy.sh`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/deploy.sh).

## Retry failed history bootstrap

A failed KurrentDB bootstrap prevents the server from using conversation history. The installer
now stops on terminal bootstrap failure and requires the actual OpenCrane server to become Ready.
Inspect the failed Job and its logs, then apply the repaired configuration through the normal silo
deployment command. An existing failed Job remains failed after a configuration update.

Once KurrentDB is Ready and the repair is applied, retry that release's bootstrap:

```bash
OPENCRANE_CHART_DIR="$PWD/apps/_infra/deploy-k8s" \
apps/_infra/deploy-k8s/platform/k8s-deploy.sh \
  --release-version 0.11.0 --cluster-tenant testv5 \
  --namespace opencrane-testv5 --release opencrane-testv5 \
  --kurrentdb-bootstrap-retry
```

Use the intended current Kubernetes context and substitute the target silo's coordinates. This
explicit action recreates only the failed or missing bootstrap Job from the installed Helm manifest.
It refuses a running, completed, foreign or deleting Job, verifies existing credentials and stream
policy, and leaves conversation data and volumes in place. It cannot be combined with preflight or
restore flags. After it succeeds, rerun the normal deployment verification and confirm public health
and an authenticated conversation before recording the silo as usable.

## Update a completed history bootstrap

Kubernetes keeps a Job's Pod template immutable. If an application update changes the KurrentDB
bootstrap image, resources or mounts, first prepare the completed Job for replacement. Then run
the normal deployment with the intended published build and bootstrap configuration:

```bash
OPENCRANE_CHART_DIR="$PWD/apps/_infra/deploy-k8s" \
apps/_infra/deploy-k8s/platform/k8s-deploy.sh \
  --release-version 0.11.0 --cluster-tenant "$OPENCRANE_CLUSTER_TENANT" \
  --namespace "$OPENCRANE_NAMESPACE" --release "$OPENCRANE_RELEASE" \
  --kurrentdb-bootstrap-prepare-update

apps/_infra/deploy-k8s/deploy.sh \
  --release-version 0.11.0 \
  --namespace "$OPENCRANE_NAMESPACE" --release "$OPENCRANE_RELEASE" \
  --base-domain "$OPENCRANE_BASE_DOMAIN" \
  --cluster-tenant "$OPENCRANE_CLUSTER_TENANT" \
  --acme-email "$OPENCRANE_ACME_EMAIL" \
  --first-user-email "$OPENCRANE_FIRST_USER_EMAIL" \
  --image-tag "$OPENCRANE_BUILD_TAG" \
  --opencrane-ui-digest "$OPENCRANE_UI_DIGEST" \
  --cognee-digest "$OPENCRANE_COGNEE_DIGEST" \
  --postgres-credentials-secret "$OPENCRANE_POSTGRES_SECRET" \
  --litellm-postgres-credentials-secret "$OPENCRANE_LITELLM_POSTGRES_SECRET" \
  --postgres-admin-credentials-secret "$OPENCRANE_POSTGRES_ADMIN_SECRET"
```

Use the intended current Kubernetes context, matching namespace and release, and the same first-owner
and OIDC coordinates as the installed silo. Set the bootstrap image or other changes through the
[conversation execution profile](#conversation-execution-profile) inputs. The second command keeps
existing release values and creates the desired bootstrap Job, then waits for verification and the
server to become Ready.

Preparation removes a completed, inactive release-owned Job and its finished Pods. It leaves history
volumes and credentials in place, requires KurrentDB to be Ready, and refuses a running, failed,
foreign or deleting Job. An absent Job needs no action. Kubernetes checks the observed Job UID and
resource version during deletion, so a concurrent change or replacement makes preparation fail;
inspect the Job before retrying. This action cannot be combined with retry, restore or preflight
flags. Use [failed-bootstrap recovery](#retry-failed-history-bootstrap) when verification failed.

## GKE storage and snapshot prerequisites

For a fresh installation that needs standard Persistent Disks, prepare a non-default storage class:

```bash
apps/_infra/deploy-k8s/platform/k8s-deploy.sh \
  --provision-gke-standard-storage-class opencrane-pd-standard \
  --context "$OPENCRANE_KUBERNETES_CONTEXT"
```

The action requires the current context to match and the GKE Persistent Disk driver to exist. It
creates or verifies one OpenCrane-owned class using `pd.csi.storage.gke.io` and `type: pd-standard`.
Volumes allow expansion and wait for their first consuming Pod before binding; deleting a volume
claim reclaims its disk through the `Delete` policy. Foreign, changed, default, or deleting classes
are refused without modification. No existing disk, claim, or cluster default changes.

Select the class for new KurrentDB volumes in the silo values profile:

```yaml
historyStore:
  kurrentdb:
    persistence:
      storageClassName: opencrane-pd-standard
    backup:
      archive:
        persistence:
          storageClassName: opencrane-pd-standard
```

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
the same CSI driver, such as `standard-rwo` or the `opencrane-pd-standard` class above. For the latter,
pass `--storage-class opencrane-pd-standard` when preparing the snapshot class. The deploy engine supplies the bounded Kubernetes API
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
