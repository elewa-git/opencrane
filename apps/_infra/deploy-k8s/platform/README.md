# deploy-k8s platform tools

This directory contains the shared tools that prepare a cluster, deploy an OpenCrane silo, upgrade
its database, and verify the result. They live beside the deploy application because no other
OpenCrane package uses them as a general-purpose library.

## What these tools are for

These files help an operator install, upgrade, verify, or retire an OpenCrane silo without having to
assemble raw Helm and Kubernetes commands by hand. Each script has one job and stops when the live
cluster does not match the assumptions needed to do that job safely.

| Path | Responsibility |
|---|---|
| `Chart.yaml`, `templates/` | Gives all workloads the same naming, access-control, database, identity, and monitoring conventions. The parent release reuses these Helm helpers; they do not install anything on their own. |
| `k8s-deploy.sh` | Installs or upgrades a silo from reviewed application images. It checks the live database first, applies the matching database and application changes, restarts services when their connection details change, and waits until the intended workloads are actually ready. An optional verification step also checks pods, DNS, and public health. |
| `invitation-signing-secret.sh` | Keeps invitation links valid across routine upgrades. It creates the silo's signing key once, checks that the saved key is usable, and reuses it instead of silently rotating it. |
| `qualified-release-image-policy.sh` | Keeps the channel proxy, memory gateway, and artifact service on one reviewed build while allowing the server to use its own reviewed build when needed. It verifies that all four images are available before Helm changes the cluster. |
| `control-plane-image-policy.sh` | Ensures the browser application is the exact reviewed build. Public deployments must use an immutable image digest; only disposable local test clusters may use a locally imported tag. |
| `cluster-tenant-crd-policy.sh` | Protects the cluster-wide tenant definition from conflicting ownership. It checks whether the definition is missing, owned by this release, safely shared, or conflicting before Helm proceeds. |
| `database-migration-orchestrator.sh` | Runs a reviewed database migration Job directly. It publishes the SQL, prepares required PostgreSQL features, waits for the Job, and removes any temporary privileges. |
| `database-pg-cron-preflight.sh` | Confirms that PostgreSQL can schedule the background work used by durable agent tasks before a migration depends on it. The check is read-only and runs against the database primary. |
| `qualify-durable-execution.sh` | Proves on a live silo that newly queued agent work is picked up within the expected time. It opens a temporary connection to the database proxy, runs the application-owned timing check, and keeps the application password out of its output. |
| `database-superuser-access.sh` | Confirms that temporary database-administrator access has been disabled and its generated credential removed before the application resumes. |
| `database-release-finalization.sh` | Restarts database consumers when connection details change and waits for the normal application rollout. |
| `k8s-teardown.sh` | Retires one standalone silo without touching shared cluster services or another tenant. It requires the exact cluster, tenant name, and expected release ownership, blocks protected tenants, and can inventory the planned deletion before removing anything. |
| `bootstrap-prerequisites.sh` | Prepares a development cluster with the shared ingress, certificate, and PostgreSQL controllers OpenCrane expects. It validates the selected cluster and network address first and refuses to take over resources it does not own. A normal silo deployment never runs it automatically. |
| `prerequisite-chart-lock.sh` | Pins the exact upstream controller packages accepted by the bootstrap. Checksums and expected cluster resources make downloaded dependencies reproducible and tamper-evident. |
| `configure-oidc.sh` | Updates OpenID Connect login settings on an existing silo without redeploying unrelated configuration. |
| `provision.sh` | Creates a supported local, Google Kubernetes Engine (GKE), or virtual-private-server cluster before OpenCrane is installed. The GKE path also creates private storage for Terraform's infrastructure record. |
| `terraform/` | Defines the optional Google Cloud infrastructure used by a GKE deployment, including encryption, networking, DNS, and the image registry. Application installation remains the deployer's responsibility. |
| `values/` | Holds reusable settings for different environments and for clusters that host more than one isolated silo. |
| `tests/` | Checks that rendered deployments still enforce the documented safety rules and proves the full install path in a disposable local Kubernetes cluster before changes reach a live environment. |

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

## Database deployment

Every invocation supplies a release version and the version it is upgrading from. When a reviewed
`<from>-to-<to>` migration directory exists, the deployer publishes its SQL as an immutable ConfigMap,
prepares `pg_cron` when that migration needs it, runs the bounded migration Job, and then continues
the ordinary application rollout. A failed Job returns its failure directly. It does not create a
backup, inspect the existing schema, pause application writes, or restore a previous release.

Operational backup and restore configuration remains available in the PostgreSQL chart, but it is not
a condition for running a migration. Deferred migration hardening work is tracked in issue #699.

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
