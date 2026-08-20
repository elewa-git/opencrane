# Deploying

All cluster mutation goes through **app-owned scripts** — never bare `helm upgrade` or `kubectl
apply` against a live cluster. This page covers the deploy chain, its prerequisites, and the
warnings that save hours of debugging.

> See also: [The CI pipeline](/contributing/ci-pipeline) (the images this chain consumes),
> [Hosting and deployment](/operators/hosting) (the operator-facing install path), and
> [Runbook](/operators/runbook) (diagnosing a cluster once it is live).

## The script-only rule

Every deploy — from a contributor's k3d smoke to a production silo — runs through the same
entrypoints. There is no supported path that touches a live cluster by hand.

```text
apps/_infra/deploy-k8s/deploy.sh
  silo profile: flags, presets
        │
        ▼
platform/k8s-deploy.sh
  the install engine
        │
        ├──→ current-chart-sources.sh
        │      packages the in-repo subchart sources
        │
        ├──→ database-migration-orchestrator.sh
        │      CNPG cluster, databases, migration + privileges Jobs
        │
        ├──→ umbrella helm upgrade
        │      all app subcharts
        │            │
        │            ▼
        │      database-release-finalization.sh
        │        credential-checksum roll, rollout waits, cert wait
        │
        └──→ post-deploy-verify.sh
               live health verification
```

- `deploy.sh` installs one per-ClusterTenant silo: operator, channel proxy, LiteLLM, Cognee,
  opencrane-ui, per-CT networking, and one app-owned PostgreSQL server with isolated logical
  databases. Required flags: `--base-domain`, `--cluster-tenant`, `--acme-email`,
  `--first-user-email`; fresh installs also need `--opencrane-ui-digest` and `--cognee-digest`
  (immutable digests, never tags).
- Cluster-wide prerequisites (ingress-nginx, cert-manager, CloudNativePG) are installed once per
  cluster by `bootstrap-prerequisites.sh` and are never part of a silo release.
- The PostgreSQL transition is resolved and schema-validated *before* the cluster is touched;
  migration and privileges run as bounded Helm hook Jobs, with an automatic rollback path that
  restores the exact fenced Helm revision on failure.
- After the umbrella upgrade, the engine stamps a checksum of the published database connection
  Secrets onto the consumer Deployments (`opencrane-server`, `litellm`, `mcp-gateway`). An
  unchanged checksum is a no-op; a changed one triggers exactly one rollout. This replaced an
  unconditional `rollout restart` that double-started the heaviest workloads on every deploy.

## Bootstrap prerequisites

Before any silo installs, the cluster needs a default StorageClass, a `NetworkPolicy`-enforcing
CNI, and — via `bootstrap-prerequisites.sh` — ingress-nginx, cert-manager and CloudNativePG. These
are cluster-wide and installed once; the silo chart assumes them and never re-installs them.

## Warnings — read before deploying

::: warning CI green first
Confirm the `docker.yml` run for the exact SHA is green before deploying. The deploy scripts pull
published images and never build them — see [The CI pipeline](/contributing/ci-pipeline).
:::

::: tip Subchart packaging is derived, never committed
Every umbrella dependency is an in-repo `file://` chart, so the checked-out commit is the version
authority: the deploy fixture packages the current sources with `helm dependency update
--skip-refresh`. There is no `Chart.lock` or vendored archive to keep in step, and a chart
version bump needs no umbrella edit. External bootstrap charts stay pinned by version and digest.
:::

::: warning A green render does not prove a live upgrade works
A passing `helm template` or CI render does not prove a live `helm upgrade` works. Stateful
services need their PVC semantics, reconcile-retry, and Secret-change pod-roll trigger checked
before deploying — see the live-upgrade checklist referenced from the deploy ledger.
:::

::: warning Never deploy with floating tags
Public releases require `sha-*` build tags or digests; the qualified-release-image policy rejects
`latest` and similar tags. Tag floating exists only for the disposable local k3d smoke.
:::

::: warning An upgrade keeps every image you do not name
Helm's reset-then-reuse cannot preserve an omitted override in a visible argument, so the engine
reads the previous release's values and inherits whatever image it finds there. A version bump on
its own therefore changes no image at all: the silo reports the new chart version and keeps running
the old build. To move an image, name it.

| To move | Pass |
| --- | --- |
| Server, channel proxy, memory gateway, artifact service | `--image-tag sha-<sha>` |
| Server only | `--opencrane-server-tag sha-<sha>` |
| Browser SPA | `--opencrane-ui-digest sha256:<digest>` |
| Cognee | `--cognee-digest sha256:<digest>` |

Every run logs the image it resolved per component, and says so explicitly when it inherits a pin
or moves off one. Read those lines before concluding that an upgrade shipped new code.
:::

- **The tenant's openclaw version pin lives in `values.yaml`, not in code defaults.**
- **Watch the queue, not only the jobs.** The organisation has a fixed number of concurrent
  runners; a workflow storm (or a hung job) can queue runs for 30+ minutes. If a run seems stuck
  before any job has started, that is queue starvation, not a slow job.
- **Develop red means every PR pays the k3d smoke.** See
  [the skip proof](/contributing/ci-pipeline#the-k3d-smoke-and-its-skip-proof). Fixing develop
  first is usually the fastest way to speed up everyone's pull requests.
- **A cancelled develop push is normal.** The workflow's concurrency group replaces a queued push
  run when a newer push arrives; only in-flight publishes are protected.

Source: [`apps/_infra/deploy-k8s`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/README.md).
