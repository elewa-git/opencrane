# deploy-k8s platform internals

This directory is the cluster and release substrate owned by `apps/_infra/deploy-k8s`. It is kept
as an internal subtree—not a top-level `libs` package—because the deploy-k8s application is its only
local source consumer.

## Contents

| Path | Responsibility |
|---|---|
| `Chart.yaml`, `templates/` | Helm library chart providing labels, names, RBAC, endpoint, database, identity, and observability helpers to the parent release. It renders no workload by itself. |
| `k8s-deploy.sh` | Provider-neutral install and upgrade engine used by the release wrapper. It requires exact repository and source release versions, classifies live database evidence, and runs the state-appropriate PostgreSQL and application transitions. One reviewed image tag is authoritative for the server, channel proxy, memory gateway, and artifact service, and the engine waits for those Deployments across the release's main and artifact namespaces. A supported browser release supplies an exact Open Container Initiative (OCI) image digest for the single-page application (SPA); the engine renders that digest, waits for its Deployment, reports desired and observed image evidence, and rejects a stale or unavailable SPA before it reports success. It republishes each database consumer's URI and waits for the exact server, LiteLLM, and Obot workloads to restart, because Kubernetes environment variables do not reload Secret changes. Its optional `--verify` check reports pod readiness, DNS resolution, and public server/database health without changing deployment success. |
| `invitation-signing-secret.sh` | Creates the standalone invitation signing key once, validates its stored shape, and preserves it across upgrades so pending links are not rotated by a routine rollout. |
| `qualified-release-image-policy.sh` | Appends the reviewed first-party tag after operator-supplied Helm values so one release cannot mix server, channel proxy, memory gateway, and artifact service builds. Public deployments require an explicit immutable `sha-*` tag and an installed registry inspector; before Helm changes the cluster, the policy checks the complete four-image release set even when an advanced values override disables one service. Local k3d imports remain verified by their blocking rollout gates. |
| `control-plane-image-policy.sh` | Small, dependency-free browser-image policy. Public browser releases require an exact OCI digest. The only tag exception is a locally imported image on a k3d context under a reserved `.test` conformance domain, so it cannot be used for a public hostname. |
| `cluster-tenant-crd-policy.sh` | Classifies the shared `ClusterTenant` CRD as absent, current-release-owned, compatible shared, or incompatible before Helm decides whether to render it. |
| `database-convergence-classifier.sh` | Read-only classifier for exact bootstrap and migration-history evidence. It reports `current`, `completed`, `source`, or `incompatible`; unreadable or ambiguous evidence is an error. |
| `database-convergence-policy.sh` | Pure owner of the twelve State × Event lifecycle outcomes across four convergence states and three transition events. Unknown states, events, and outcomes fail closed. |
| `database-migration-recovery.sh` | Server-fence and failure-recovery owner. It captures the pre-fence Helm revision, proves the write fence, and restores that exact revision only while the migration Job is terminal and the database still proves the source state. |
| `database-migration-orchestrator.sh` | State-dependent PostgreSQL sequencing for current adoption, previous-version recovery, exact SQL publication, backup evidence, migration, and privilege reconciliation. It consumes a manifest-resolved transition and never selects or edits migration SQL. |
| `database-release-finalization.sh` | Application finalization owner after the database release transition. It strictly inventories and restarts database consumers, waits for final rollouts, and restores the exact fenced Helm revision if un-fencing or readiness fails. |
| `bootstrap-prerequisites.sh` | Explicit operator bootstrap for the pinned ingress-nginx, cert-manager, and CloudNativePG cluster-wide controllers, plus the narrowly selected GKE Autopilot database-proof ComputeClass. It validates the exact Kubernetes context and reserved regional address before mutation, fails closed around existing foreign resources, and installs resource-bounded development profiles from `values/prerequisites/`. It is not invoked by a silo deployment. |
| `prerequisite-chart-lock.sh` | Immutable upstream chart coordinates, SHA-256 archive identities, and complete rendered cluster-scoped resource inventories consumed by the bootstrap and render contract. |
| `configure-oidc.sh` | Surgical OIDC configuration for an existing installation. |
| `provision.sh` | Optional local, GKE Autopilot, or VPS cluster provisioning invoked before deployment. The GKE path bootstraps a private, versioned Terraform-state bucket in the cluster region; set `OPENCRANE_TERRAFORM_STATE_BUCKET` only when the deterministic `<project>-<cluster>-tfstate` name cannot be used. |
| `terraform/` | GKE Autopilot with regional CMEK, plus opt-in networking, DNS, and Artifact Registry resources. Application charts remain owned by `deploy.sh`. |
| `values/` | Reusable environment and multi-instance deployment profiles. |
| `tests/` | Rendered contract checks plus the blocking disposable-k3d current-silo smoke used on `develop`. |

`tests/develop-smoke.sh` exercises the real silo deploy entrypoint. It rebuilds Nx-affected images
from the checkout through a per-project BuildKit cache and resolves unaffected owners from the exact
digest of the last validated image set. Its sequential image lane overlaps cluster and controller
preparation, then imports the complete image inventory in one k3d transfer. A pull request bypasses
that cluster only when one positive proof binds its exact base SHA to a completed successful push or
manual-dispatch k3d job, no affected container owner, and only explicitly non-deployment paths. The same evidence works
for `develop` and reviewed feature-stack bases; unknown or unavailable evidence fails closed to
k3d. Both tiers install pinned cert-manager and
CloudNativePG and fail on workload, database, Certificate, or TLS health. Ordinary pull requests use
fast local-path storage; `develop`, explicit k3d dispatches, and storage-sensitive changes install
the pinned expandable hostpath CSI driver and exercise expansion. Set `KEEP_CLUSTER=1` for local
diagnosis. Backup/restore and production storage, DNS, and transport remain separate live
qualifications.

Business logic does not belong here. Server-process infrastructure belongs in `libs/backend/server/infra`;
backend capabilities belong in `libs/backend/server`; independently owned third-party workloads
belong in sibling `apps/_infra/<service>` projects.

## Versioned database deployment

Every invocation supplies `--release-version <current-root-version>` and an exact
`--from-release-version` (`fresh`, the same current version, or the immediately preceding minor).
The engine resolves both immutable release manifests before cluster mutation. Fresh installs skip
migration. For an eligible migration transition with a live database, a read-only query classifies
its protected bootstrap origin and complete history tuple before any SQL publication or server
fence. `current` covers a current baseline created before the release ledger existed; `completed`
covers an already-applied exact migration. Both reconcile privileges with migration disabled and
continue the normal application Helm transition without fencing. Incompatible, unreadable, extra,
or ambiguous evidence stops before fencing.

Only `source` publishes the manifest-selected SQL, captures the exact current application Helm
revision, and then fences the old server. It proves a CloudNativePG (CNPG) backup before running the
bounded migration Job. If a post-fence stage fails, recovery first proves that Job is absent or
terminal and reclassifies the database. It rolls back the application to the captured revision only
when the database remains exactly `source`; an active or unknown Job, advanced database, unreadable
evidence, or failed rollback leaves the fence active and the original failure status unchanged. A
previous-version physical restore remains fail-closed: recovery configuration must render before the
fence, and the restored database must pass the same classifier before SQL can be published.
If a process stops after migration but before un-fencing, a rerun adopts only the exact persisted
source/target fence and its positive previous replica count. Final application failure restores that
fenced revision, never the now-incompatible running source application.

An automatic source migration additionally requires the PostgreSQL chart's plugin-backed `ScheduledBackup`.
The engine creates a dedicated on-demand `Backup` and waits for completed controller evidence; a
flag, annotation, or operator acknowledgement is not recovery evidence. An operator may explicitly
run an approved carry-forward repair with `--allow-unbacked-database-migration` while no provider is available;
this skips only backup creation and leaves the write fence, exact source classifier, transactional
migration Job, convergence proof, and failure recovery active. The deployer rejects that override for
fresh, current, and ordinary migration transitions. A completed carry-forward re-entry accepts the
flag but performs no backup or migration, so the override is inert. The override is CLI-only so it
cannot persist as an environment default.
It preserves an existing
Cluster's original initdb ConfigMap and protected origin digest while publishing the current baseline
separately for convergence proof. The Helm-owned `migrationFence` records source/target versions and
the previous replica count. It stays active whenever failure evidence does not safely permit the
exact pre-fence rollback, or when the final application upgrade fails.

## OIDC upgrades

A fresh OIDC deployment must provide its confidential-client secret through
`OPENCRANE_OIDC_CLIENT_SECRET` or `--oidc-client-secret`; the engine creates the release-local
`opencrane-oidc` Secret only from that input. Later upgrades may omit it when that Secret already
contains both the client and session keys. The engine retains the existing Secret in that case, so
ordinary image or configuration rollouts do not rotate login sessions or require an IdP secret to
be supplied again. A missing or incomplete existing Secret still fails closed.

## Member invitation authority

`OPENCRANE_MEMBERSHIP_MODE` selects `standalone` by default or `fleet` for a Fleet-owned silo. The
standalone profile creates `opencrane-invitation-signing` once and retains its base64url key on
later upgrades. The server mounts that Secret only in standalone mode, so ordinary releases do not
invalidate pending invitation links. Installers that bypass the app-owned deploy script must provide
the Secret named by `clustertenantManager.membership.standalone.invitationSigningExistingSecret`.

Fleet mode does not mount the standalone key. It requires an HTTPS membership-and-billing gateway
origin and the exact silo identity Fleet binds to the OpenCrane server's audience-bound projected
ServiceAccount token, in addition to Fleet's independent membership-revision verification key. The
browser still calls the same silo API; a missing or unavailable Fleet gateway fails closed and never
enables local writes. The receiver and payment-provider integration remain Fleet/WeOwnAI-owned.

The engine always enables LiteLLM's database-backed model store for a managed silo. It supplies
the release-local LiteLLM database and stable encryption salt, then OpenCrane registers provider
models through LiteLLM's admin API. Leaving that store disabled would retain a provider credential
but make model registration fail at server startup.

## Shared controller bootstrap

Cluster-wide controllers remain outside the organisation release boundary. A cluster operator may
install the supported development substrate explicitly after provisioning a GKE Autopilot cluster:

```bash
apps/_infra/deploy-k8s/platform/bootstrap-prerequisites.sh \
  --context gke_PROJECT_REGION_CLUSTER \
  --project-id PROJECT \
  --region europe-west1 \
  --ingress-address-name RESERVED_ADDRESS \
  --yes
```

The command downloads each locked archive once, verifies its committed SHA-256, renders that local
archive before it changes the cluster, then installs the same bytes with atomic, waited Helm upgrades.
Its complete cluster-scoped inventory prevents accidental adoption of foreign CRDs, RBAC, ingress
classes, or webhooks. Bootstrap-owned namespaces carry explicit retry markers so an atomic first-run
failure can be retried without accepting an arbitrary pre-existing namespace. The GKE profile keeps
cert-manager leader election in its own namespace because Autopilot denies third-party writes to its
managed `kube-system` namespace. It never installs
external-dns or DNS credentials and it does not create a cluster-wide certificate issuer. Each silo
owns its namespaced HTTP-01 `Issuer`; the operator creates the serving DNS record only after the
ingress Service reports the reserved address.

The bootstrap also owns `opencrane-database-proof`, a GKE Autopilot ComputeClass used only by the
short-lived PostgreSQL privilege-proof Job through `values/postgres-gke-autopilot.yaml`. Its explicit
`ScaleUpAnyway` policy allows the proof to receive capacity when GKE system balloon Pods reserve all
otherwise idle capacity. Its `general-purpose` pod family uses GKE's Autopilot container-optimized
compute platform and pod-based billing; GKE manages the node shape and boot disk because explicit
storage cannot be combined with this pod family. The Job retains its three one-GiB
ephemeral-storage requests. The class does not change the Job's database grants, credentials,
network path, or completion requirement.

The pinned ingress-nginx release is accepted only for this single-silo development qualification.
The upstream project is archived, so a supported ingress controller must replace it before a
production or shared multi-tenant deployment.
