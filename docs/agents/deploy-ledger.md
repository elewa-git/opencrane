# Deploy ledger

Append-only log for deployment runs against the current OpenCrane architecture. The `deploy` agent
reads this file before every run and appends one concise evidence block afterwards.

Historical deployment evidence for removed product paths remains available in Git history and must
not be reused as current operational guidance.

## Format

```text
## <date> · <environment> · <profile> · <sha> · <LIVE|PARTIAL|FAILED>
- findings: <class>: one evidence-backed line per finding
- friction: repeated configuration or script difficulty
- lesson: what the next run must verify
```

When a lesson is fixed at its source, replace it with a one-line pointer to the fixing pull request.
Full run reports belong in the corresponding pull request or issue.

## Standing lessons

- Resolve chart dependencies from `Chart.lock` with `helm dep build`.
- Put repeatable environment configuration in a checked-in values profile.
- A passing render does not prove an in-place upgrade will accept immutable-field changes; inspect
  the live object and release manifest before applying.
- Verify the running image digest and application health after rollout.
- Mutate clusters only through the app-owned deployment scripts.

## Runs

## 2026-08-05 · dev · GKE cluster-only · fba5e7ae1f7fa110be7a921a5ae4a2a69927d5a2 · LIVE

- findings: none; the remote-backend Terraform plan reports no changes and all live regional GKE,
  CMEK/IAM, state, context, and API checks pass.
- friction: earlier HCL syntax, Bash 3.2 portability, and CMEK read-back drift required repair
  iterations before final qualification.
- lesson: gate future GKE provisioning on Terraform formatting and validation, Bash 3.2 contract
  coverage, an unlocked regional backend, and a post-create no-op plan; zero nodes are expected for
  an empty Autopilot cluster.

## 2026-08-05 · dev · GKE shared prerequisites · 97bbdfa2afeb613ac29ccdbbf64249689a3c7762 · FAILED

- findings: script: Helm 4 rejected the removed `helm list --all` flag before any namespace,
  release, or cluster-scoped resource was changed.
- friction: the contract suite covered Helm 3 release discovery but not Helm 4's explicit status
  union.
- lesson: keep release discovery compatible with both supported Helm major versions and fail before
  mutation when the local client contract is unsupported.

## 2026-08-05 · dev · GKE shared prerequisites · f49d8e6459ae2c4f4bdea02361fd17ba27a1a3d1 · PARTIAL

- findings: config: ingress-nginx reached Ready on reserved address `35.205.225.244`; cert-manager's
  cainjector could not acquire its lease in Autopilot-managed `kube-system`, so the atomic release
  rolled back while its established retained custom resource definitions remained; CloudNativePG
  was not attempted.
- friction: cert-manager's upstream default election namespace crossed GKE Autopilot's managed
  namespace boundary.
- lesson: pin third-party leader election to the controller's own namespace and accept only the
  bootstrap-owned retained-resource retry shape.

## 2026-08-05 · dev · GKE shared prerequisites · 6da7110f063b9b08efcb02bf14a040a3462a083e · LIVE

- findings: infra: ingress-nginx `4.15.1`, cert-manager `v1.21.1`, and CloudNativePG `0.29.0` are
  deployed and Ready with the locked chart digests; all required webhooks, ingress class, and
  certificate/database custom resource definitions are present. `europe-west1` SSD quota is
  `475/500 GiB`, so a 50 GiB OpenCrane silo cannot be admitted yet.
- friction: GKE Autopilot raised sub-minimum requests to `50m/52Mi` or `100m/103Mi`; recursive DNS
  continued to serve the prior wildcard address after the dedicated authoritative record changed.
- lesson: render and cost the admitted request floor, free at least 25 GiB more SSD quota without
  deleting unverified data, and wait for public DNS convergence before requesting the silo's ACME
  certificate.

## 2026-08-05 · dev · testv2 single-silo preflight · 0a526d8df3f7676b7e50f3a1445806680d3484ad · FAILED

- findings: config: the executor has no OIDC issuer/client/client-secret inputs; `opencrane-testv2`
  and its four required external PostgreSQL basic-auth Secrets do not exist; `dev.opencrane.ai` has
  no delegated NS record although `testv2.dev.opencrane.ai` resolves to the ingress.
- friction: the silo deployer intentionally validates external database credentials but the repository
  has no app-owned credential-provisioning entrypoint for a fresh namespace under the script-only rule.
- lesson: supply the secure OIDC source and pre-provisioned credential Secret names, select an explicit
  expandable StorageClass, and restore base-domain delegation before retrying the silo deploy.

## 2026-08-05 · dev · testv2 single-silo preflight correction · 0a526d8df3f7676b7e50f3a1445806680d3484ad · PARTIAL

- findings: script: later direct inspection proves `standard-rwo` is the default expandable class;
  the previous default-StorageClass finding was incorrect. The preflight's child-NS test is instead
  too strict for `dev.opencrane.ai`, which is served by the `opencrane.ai` zone and need not be a
  delegated zone itself.
- lesson: validate that the supplied base domain has authoritative DNS service, not that it is a
  separately delegated zone; retain the missing external credential and OIDC-input findings.
