# deploy-k8s — silo umbrella chart & deploy entrypoint

> [apps](../../README.md) › [_infra](../README.md) › deploy-k8s

<!-- No import alias: this deployable is a Helm umbrella chart plus a deploy script.
     Named by its `project.json` (`deploy-k8s`). This README is the overview altitude;
     the deep detail lives in the linked sub-docs. -->

## What it owns

This is the **install root** for one **silo** — one customer's isolated slice of OpenCrane. The
trusted services run in the release namespace; untrusted personal-agent Jobs run in a sibling runtime
namespace owned by the same release. Nothing is shared with other customers. Everything else under `apps/` ships a small
Helm chart; this app is the **umbrella chart** (`opencrane-silo`) that pulls those deployment
contracts together into one release, plus `deploy.sh`, the entrypoint that installs and upgrades it.

Think of it as the assembly point: each app owns its own workload templates, and this chart composes
them — unchanged — with one shared release context. It renders nothing customer-specific itself; it just
wires the pieces and the per-silo networking together.

```
 deploy.sh  (per-ClusterTenant silo profile)
        │  package checked-out file:// charts → helm upgrade --install
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │  opencrane-silo umbrella chart  ◄── HERE                     │
 │    composes app-owned template libraries into one release:   │
 │    server · opencrane-ui · channel-proxy · artifact-service  │
 │    · artifact-preprocessor · agent-controller                 │
 │    · skill-authoring · tool-runner                            │
 │    · cognee · litellm · obot                                  │
 └────────────────────────────────────────────────────────────┘
        │  requires (external prerequisites, NOT installed here)
        ▼
 ingress controller · serving DNS · CloudNativePG · cert-manager
```

**In this flow:** [opencrane server](../../opencrane/README.md) · [opencrane-ui](../../opencrane-ui/README.md)
· [channel-proxy](../../channel-proxy/README.md) · [artifact-service](../../artifact-service/README.md)
· [artifact-preprocessor](../../artifact-preprocessor/README.md) · [artifact-scanner](../../artifact-scanner/README.md)
· [agent-controller](../../agent-controller/README.md) · [skill-authoring](../../skill-authoring/README.md)
· [tool-runner](../../tool-runner/README.md)
· [postgres](../../postgres/README.md) · [cognee](../cognee/README.md) · [litellm](../litellm/README.md)
· [obot](../obot/README.md)

A silo installs **only** its own namespaced app releases. `--image-tag` selects one reviewed
OpenCrane build for the server, channel proxy, memory gateway, and artifact service; the deploy
engine applies it after all values overrides and waits for those Deployments in both the main and
artifact namespaces. The browser UI and Cognee keep their separate digest-pinning rules.
Public deployments require an explicit immutable `sha-*` `--image-tag` and a registry inspector
(`skopeo`, `crane`, or `docker`). The deploy engine checks all four tagged image references before
it changes either Helm release. This is a release-set check: an advanced values override that
disables one of these services does not remove its image from qualification. The local k3d smoke
keeps using images imported directly into its nodes and proves them through the same blocking
Deployment rollout gates.
Cluster-wide controllers (ingress,
CloudNativePG, cert-manager) and serving DNS are external prerequisites a silo never installs.
"External" here means outside the organisation release: a cluster operator may explicitly install
the pinned development controller set with `platform/bootstrap-prerequisites.sh`, but `deploy.sh`
never invokes that helper. The app-owned chart helper runs `helm dependency update --skip-refresh`
against the checked-out in-repo `file://` sources. The commit is the version authority; ignored
`Chart.lock` and `charts/` outputs are derived packaging, not release inputs.

The artifact preprocessor runs in its own PSA-restricted sibling namespace with a fixed zero-RBAC
identity, bounded scratch, and no ArtifactStore route. The personal `agent-runtime` image is
deliberately absent from the long-lived Deployment rollup. It is not a
long-lived silo service: the agent controller creates its bounded, suspended Job for each authorised
run attempt and commits the Kubernetes-issued Job identity to OpenCrane. Workload lifetime and
Kubernetes identity therefore remain tied to that attempt. The release still owns the runtime
namespace, its zero-RBAC ServiceAccount, default-deny and fixed-egress policies, and a uniquely named
cluster-scoped admission policy that permits only the exact digest-pinned Job shape and its one-time
unsuspend transition. An aggregate ResourceQuota bounds conforming Jobs, Pods, CPU, and memory even
if the controller identity is compromised. The admission boundary requires Kubernetes 1.30+.

## Public surface

`Entrypoint: deploy.sh` — the per-ClusterTenant silo deploy profile, a thin wrapper over the shared
install core (`platform/k8s-deploy.sh`). It requires a base domain, a ClusterTenant name, one
`--first-user-email` value, one pre-created PostgreSQL basic-auth Secret per logical database
(server, Obot, LiteLLM, and database administration), and the reviewed single-page application (SPA)
`--opencrane-ui-digest`. The named email is non-secret and only selects the verified OIDC identity
that can claim the silo's one subject-bound Owner row at first login; deployment never writes a user
row directly. A new silo can also pass `--initial-model-provider` with
`OPENCRANE_INITIAL_MODEL_API_KEY` in its environment; the key never enters Helm values and is
registered through the release-local LiteLLM before the server becomes ready.

`Entrypoint: teardown.sh` — retires one exact standalone silo after checking the kubectl context,
tenant, namespace, exact chart identities from `releases/<version>.json`, retained CloudNativePG
data ownership, and a tenant-name confirmation. It requires explicit evidence that the matching DNS host and Zitadel callback have
already been retired; it never guesses which external record or identity-provider application to
change. The caller must also name the currently protected tenant explicitly; environment-specific
tenant policy is never hard-coded in the reusable teardown engine. The retry-safe cleanup uninstalls only the tenant and PostgreSQL releases, then removes the
exact keep-marked database resources, their doubly-labelled data volumes, release-derived auxiliary
namespaces, and exact tenant-suffixed cluster role bindings. Shared controllers, custom resource
definitions, ingress, certificate management, ComputeClass, and the protected active tenant remain
outside its deletion surface.

## Boundary

The umbrella renders no business logic and installs no cluster-wide controller. It composes app-owned
templates, the server and runtime namespaces, per-silo `NetworkPolicies`, and the runtime Job's
release-scoped `ValidatingAdmissionPolicy`; it does not own the workloads themselves (each app does) or
the shared substrate helpers (the `k8s-platform` library does). Self-service ClusterTenant management and
billing are OFF — a silo serves exactly one ClusterTenant.

## Dependency direction

An app entrypoint (`type:app`); it composes app template libraries and the `k8s-platform` substrate. No
package imports it.

## Runtime & config

- Umbrella chart: `Chart.yaml` (`opencrane-silo`), values in `values.yaml`, and schema in
  `values.schema.json`. Its app-owned helper packages the checked-out local chart sources.
- `agentController.runtimeNamespace` — optional DNS-label override for the sibling runtime namespace;
  empty derives `<release>-runtime`, and the chart rejects the trusted server namespace.
- `artifactPreprocessor` — disabled until its immutable image digest is supplied; when enabled, the
  worker runs in a dedicated restricted namespace and receives only ephemeral scratch plus
  broker/DNS/optional-telemetry egress.
- `artifactScanner` — disabled until its immutable image digest is supplied; when enabled, the
  worker scans quarantined uploads in a separate restricted namespace through the server broker.
- `agentController.runtimeQuota` — aggregate Job, Pod, CPU, and memory ceilings for the dedicated
  untrusted runtime namespace.
- `opencrane-skill-authoring.skillAuthoring` — the separate, default-deny candidate-skill namespace
  and aggregate Job quota; it contains no standing worker. The deploy engine derives
  `<release>-skill-authoring`, so different silos never share its Helm-owned namespace.
- `opencrane-tool-runner.toolRunner` — the separate, default-deny tenant-tool namespace and aggregate
  Job quota; it contains no standing worker. The deploy engine derives `<release>-tools` for the
  same per-silo ownership boundary.
- `--release` — optional only as a restatement of the silo identity. The wrapper derives and
  enforces `opencrane-<cluster-tenant>` so all Helm-owned namespaces stay inside one release.
- `crds.install` — resolved authoritatively by the deploy engine: the first silo installs the
  shared `ClusterTenant` CRD, while later silos consume it without competing for Helm ownership.
- `--first-user-email` — required standalone-onboarding input. It is matched exactly against an
  IdP-verified email after a browser login on this silo host, then records only that identity's OIDC
  `sub` as the local Owner. It is distinct from `--platform-operator-seed-email` and grants no
  platform-wide operator privilege. The deploy engine rejects an issuer change after this contract
  exists, because a `sub` is scoped to its original OIDC issuer. Later upgrades must restate that
  same `--oidc-issuer-url`; they may not use chart `--values` or `--reset-values`, which could
  replace or erase the binding.
- `--initial-model-provider` plus `OPENCRANE_INITIAL_MODEL_API_KEY` — optional bootstrap of the first
  supported model provider. The engine writes the key to the release-local provider-custody Secret;
  the server then registers its encrypted LiteLLM credential and catalogue before accepting work.
- `--opencrane-ui-digest` — required Open Container Initiative (OCI) `sha256:` identity of the reviewed SPA build. The engine
  renders `repository@digest`, waits for the SPA rollout, and refuses success if the Deployment or
  ready Pods do not show that image. `OPENCRANE_ALLOW_TAG_FLOAT=1` is only for a disposable local
  install on a k3d context under a `.test` domain whose image never left the local runtime; it is
  rejected for every browser release hostname, including `testv4.dev.opencrane.ai`.
- `teardown.sh --release-version <version> --confirm-retire <tenant>` — destructive retirement; the repository-owned `protected-cluster-tenants.json` registry blocks active tenants independently of caller input
  requires the exact installed repository version, tenant text, kubectl context, and external
  retirement acknowledgements for the derived DNS host and Zitadel callback. The release manifest
  binds both expected chart identities exactly; a prefix match is never accepted. Run it with
  `--preflight` first to inventory ownership without changing the cluster.
- Reusable environment/multi-instance profiles live under `values/` and `platform/values/`.
- `npx nx run deploy-k8s:test` and `npx nx run deploy-k8s:helm-lint` package a disposable copy of
  the current app-owned chart sources. They therefore validate the checked-out release contract
  without treating generated `Chart.lock` or `charts/*.tgz` files as tracked inputs.
- `npx nx run deploy-k8s:develop-smoke` creates a disposable k3d cluster, rebuilds Nx-affected
  OpenCrane workloads with per-project BuildKit caches and reuses digest-validated baseline images
  for unaffected owners, then installs the silo through `deploy.sh`. Image preparation overlaps
  disposable-cluster prerequisites and transfers the complete image set in one import. A pull
  request may reuse the exact base qualification only when an exact-SHA push or manual dispatch
  already completed the same k3d job successfully, Nx selects no container owner, and every changed path is explicitly
  non-deployment input. This works for both `develop` and reviewed stacked bases; any missing,
  expired, or uncertain evidence runs k3d. Ordinary pull
  requests use fast local-path storage; storage-sensitive changes, manual k3d qualification, and
  every `develop` push also prove pinned expandable storage. Neither tier substitutes for
  backup/recovery or production qualification.

## Sub-docs (the deep detail)

- **[platform/README.md](platform/README.md)** — the cluster and release substrate: the `k8s-platform`
  Helm library (labels, names, RBAC, endpoint/database/identity/observability helpers), the
  `k8s-deploy.sh` install engine, including the fenced, primary-verified `pg_cron` prerequisite for
  durable-task database transitions, explicit shared-controller bootstrap, OIDC configuration, cluster
  provisioning, Terraform, values profiles, and the k3d conformance tests.
## See also

- Parent index: [_infra](../README.md)
- Composed apps: [opencrane server](../../opencrane/README.md) · [opencrane-ui](../../opencrane-ui/README.md)
· [channel-proxy](../../channel-proxy/README.md) · [artifact-service](../../artifact-service/README.md)
  · [artifact-preprocessor](../../artifact-preprocessor/README.md)
  · [artifact-scanner](../../artifact-scanner/README.md)
  · [agent-controller](../../agent-controller/README.md)
  · [skill-authoring](../../skill-authoring/README.md) · [tool-runner](../../tool-runner/README.md)
  · [postgres](../../postgres/README.md)
- Composed infra: [cognee](../cognee/README.md) · [litellm](../litellm/README.md) ·
  [obot](../obot/README.md)
