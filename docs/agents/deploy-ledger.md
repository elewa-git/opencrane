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

- Package every in-repo `file://` chart from the checked-out commit with the app-owned current-source
  helper. It runs `helm dependency update --skip-refresh`; `Chart.lock` and `charts/` are ignored
  derived artifacts and must not become a second version authority.
- Put repeatable environment configuration in a checked-in values profile.
- A passing render does not prove an in-place upgrade will accept immutable-field changes; inspect
  the live object and release manifest before applying.
- Verify the running image digest and application health after rollout.
- Mutate clusters only through the app-owned deployment scripts.
- The minimal single-silo handoff is context, tenant/domain, OIDC issuer/client/secret, first
  operator, three distinct external database bootstrap Secrets, and a pull Secret only for private images.
- On GKE Autopilot, prove the database-privileges Job schedules; requested capacity, not observed
  workload use, decides admission.

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

## 2026-08-05 · dev · testv2 single-silo namespace deploy · d2f26df0bf257c00be4aea3892174b016e0c057c · PARTIAL

- findings: infra: PostgreSQL and its pooler are Ready, but a later database-privileges hook cannot
  schedule on the three-node Autopilot fleet (`Insufficient memory` / pod-capacity events), so the
  app-owned deployment stops before changing the tenant Helm release. config: the server remains
  fail-closed on the absent Fleet-owned membership-verification public-key Secret. CI: the manual
  bootstrap-image workflow is green and published immutable `sha-d2f26df0` channel-proxy and
  memory-gateway images after recording Linux Terraform-provider checksums.
- friction: image-only recovery still reconciles PostgreSQL first; a shortcut that skipped the hook
  was rejected in independent review because it could bypass unproven database grants.
- lesson: keep the database privilege proof intact; qualify a low-cost, schedulable retry design or
  obtain stable Autopilot capacity before retrying the tenant Helm release, and source the Fleet
  verification key from its owning authority before attempting server readiness.

## 2026-08-06 · dev · testv2 standalone server-image retry · 165722867925aee88394dd7cda08d4468879e958 · PARTIAL

- findings: CI: the full manual workflow, including `ghcr.io/elewa-git/opencrane-server:sha-16572286`, completed successfully. infra: the app-owned deploy script reconciled PostgreSQL but its required three-container database-privileges Job remains Pending; all three Autopilot nodes report 99% requested memory because GKE-managed `gke-system-balloon-pod` workloads reserve the remaining capacity. config: the tenant Helm release was not upgraded, so the old Fleet-key server mount remains live and has not yet exercised standalone mode.
- friction: Autopilot provisioned a new node for the pending Job, then a system-node-critical balloon Pod consumed its free allocation; low measured memory usage therefore does not imply schedulable capacity.
- lesson: do not bypass database privilege proof or mutate GKE-managed balloon Pods. Qualify and implement a low-cost Autopilot placement/resource design that schedules the proof Job before retrying the release; the standalone membership mode is ready to validate once that gate passes.

## 2026-08-07 · dev · testv2 single-silo OpenAI bootstrap · ab4c3614 · LIVE

- findings: config: the first model registration exposed that LiteLLM model persistence was disabled;
  the deploy engine now enables the database-backed model store and explicitly references its stable
  salt Secret. script: normal OIDC upgrades now retain a complete release-local Secret rather than
  requiring the confidential client secret to be re-supplied.
- friction: a cold GKE Autopilot ComputeClass node takes several minutes to schedule and pull the
  three-container database-privileges proof; keep the proof intact and run the app-owned deployer in
  a persistent terminal session.
- lesson: accept a single-silo model-provider gate only after the server logs successful LiteLLM
  credential and model registrations, every workload is Ready, and public `/healthz` reports a
  database-backed healthy response.

## 2026-08-07 · dev · testv2 standalone first-owner deployment · 52726181 · PARTIAL

- findings: chart/script: OpenCrane revision 28 and PostgreSQL revision 45 deployed through the
  app-owned deployer. The ready server runs CI image `sha-685fb4e`; public `/healthz` returns 200
  with `{"status":"ok","db":true}`, and the login route returns a Zitadel authorization redirect.
  The release binds `testv2`, `jente@elewa.ke`, the Zitadel issuer/client, and an OpenAI LiteLLM
  provider secret. The first login may atomically create only that verified subject's Owner membership.
- friction: three deployer defects surfaced before the release could roll: `--set-string` forwarding,
  strict-mode expansion of an empty raw-Helm-argument array, and preserving the profile's immutable
  ClusterTenant binding on later upgrades. CI's `type=sha` tag is seven characters; deploying an
  invented eight-character tag causes an explicit GHCR NotFound pull failure.
- lesson: deploy profiles must carry the immutable first-owner binding on every rerun, and the core
  guard must allow only its identical `--set-string` ClusterTenant while rejecting issuer, email, and
  all other first-user mutation. Read the exact published image tag from CI before a live pin.
- open: Jente must log out and back in to exercise the first callback and create the local Owner row.
  The pre-existing `artifact-service` ImagePullBackOff also keeps the namespace short of full
  workload health; it is unrelated to the first-owner path.

## 2026-08-07 · dev · testv2 artifact recovery and workload qualification · 7ebcfa89 · PARTIAL

- findings: CI run `31173602224` passed its build, test, lint, and artifact-image publication gates.
  The app-owned deployer applied OpenCrane revision 30 and PostgreSQL revision 48 with
  `opencrane-artifact-service:sha-7ebcfa8`. The artifact deployment is `1/1 Available`, every main
  namespace deployment is Ready, the database-privileges Job completed, public `/healthz` returns 200
  with `{"status":"ok","db":true}`, and `/api/v1/auth/login` redirects to Zitadel client
  `384935596856002567` with the exact configured callback.
- friction: artifact-service had no CI-published image, then exposed an undeclared runtime
  `@noble/hashes` dependency. CI gained explicit artifact publication, and the artifact workspace now
  declares its emitted runtime dependency. The live validation also exposed a Helm-contract parser
  that ignored a final YAML `Role` document; it now flushes at EOF and asserts that the role exists.
- lesson: deployment qualification must include every enabled workload's Ready state, not only the
  main namespace. Pin the seven-character CI SHA tag and run the app-owned deployer through its
  completion; GKE Autopilot may reschedule a newly updated pod while it preserves availability.
- open: Jente must still log out and log back in to invoke the proof-bearing Zitadel callback once.
  That callback creates the local `testv2` Owner membership and removes the existing session's
  `/no-tenant` result. Personal-agent/workspace creation and Phase E runtime qualification remain
  separate live gates.

## 2026-08-07 · dev · testv2 first-owner callback selector repair · fc53af6d · PARTIAL

- findings: the first real Zitadel callback reached the server and exposed a Prisma validation error:
  the compound `(clusterTenant, subject)` selector incorrectly included the in-memory
  `mayCreateOwner` authorization flag. CI run `31175039722` passed build, test, lint, and published
  server image `sha-fc53af6`; its exact selector regression test passes. The app-owned deployer
  applied OpenCrane revision 32 and PostgreSQL revision 49. Server, LiteLLM, and MCP gateway are
  `1/1 Ready`; public `/healthz` returns database-backed 200 and the login endpoint redirects to
  the configured Zitadel client.
- friction: the database privileges Job was pending only while Autopilot created its isolated
  ComputeClass node and pulled its three PostgreSQL containers. It then completed and did not cause
  application downtime.
- lesson: first-owner admission values contain both durable lookup fields and in-memory authority;
  repositories must select only durable model fields. A configured callback redirect is not callback
  qualification: the first real OIDC return must exercise the admission transaction.
- open: Jente must run the login once more to create and confirm the local `testv2` Owner row.
  Personal-agent/workspace creation and Phase E runtime qualification remain separate live gates.

## 2026-08-07 · dev · testv2 current-UI tenant rendering repair · 6a09541a · COMPLETE

- findings: the corrected Zitadel callback returned `302 /` and created the active `testv2` Owner
  membership. The old `opencrane-ui:latest` bundle then requested the removed `/api/v1/tenants`
  endpoint and rendered `/no-tenant`, despite `/auth/me` resolving the membership. CI run
  `31176563689` passed and published `opencrane-ui:sha-6a09541`; it adds the explicit, app-owned
  `ui` publication selection. The app-owned deployer applied OpenCrane revision 33 and PostgreSQL
  revision 50, pinning UI `sha-6a09541`, server `sha-fc53af6`, and artifact service `sha-7ebcfa8`.
  UI is `1/1 Ready` and public health remains database-backed 200.
- lesson: a single-silo qualification must pin every workload image to CI evidence. A healthy
  callback and a correct server `/auth/me` response do not validate the customer journey when the
  SPA can remain at an unrelated `latest` image.
- open: refresh an already-open browser tab to load the pinned UI bundle. The first-user
  callback/membership gate is complete; personal-agent/workspace creation and Phase E runtime
  qualification remain separate live gates.

## 2026-08-10 · dev · testv2 silo retirement · 2004e2a4 · LIVE

- findings: infra: the testv2 DNS record and Zitadel callback/origin/logout entries were removed,
  then a reviewed app-owned retirement script accepted the frozen UID and complete namespaced-API
  inventory for `opencrane-testv2`, `opencrane-artifacts`, `opencrane-skill-authoring`, and
  `opencrane-tools` before deleting those four namespaces. The disjoint testv3 application and
  PostgreSQL releases remain deployed; every testv3 deployment and pod is Ready/Running.
- friction: the legacy testv2 chart used non-prefixed auxiliary namespaces and co-owned shared
  cluster-scoped infrastructure, so its retirement could not safely reuse the current tenant-prefixed
  Helm uninstall path. The one-time exact-inventory script was removed immediately after execution.
- lesson: every future silo must use tenant-prefixed auxiliary namespaces and the reusable teardown
  entrypoint with an explicit protected-tenant input; never retain environment-specific retirement
  code after its live evidence is recorded.

## 2026-08-10 · dev · testv3 latest preflight · 7860505e8227597ce17cc7809b64d9b9489478f4 · FAILED

- findings: data: testv3 records protected baseline `22cd09a95a1b8dc2ac2fff0b91053dfe8cc7fdc7021f8dc922350d35254f7d6f`, has no `opencrane_migrations.schema_history`, and already has the 0.8-only `public.user_onboardings` table; the declared 0.7-to-0.8 path requires source digest `25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d` and would fail `OC705` after fencing the server.
- friction: the deploy preflight does not prove database transition compatibility before its mutation phase, and the migration sequence has no automatic release-fence restoration on failure.
- lesson: add a reviewed, app-owned adoption transition for the exact pre-ledger `22cd09a9` testv3 baseline (or an approved rebuild path) and prove migration compatibility before fencing; testv3 remained unchanged at Helm revision 1 on `sha-2004e2a` and healthy.

## 2026-08-18 · dev · testv4 invited-user callback repair · 864d4117fde5dcb6a1fc5519e227992a0a2db462 · PARTIAL

- findings: codebase: PR #667 preserves an authenticated invited user when standalone first-owner
  admission reports `already_claimed`, while a product-access gate permits only the invitation
  acceptance command before exact active membership exists. CI runs `32177999107` and `32180088603`
  qualified and published `ghcr.io/elewa-git/opencrane-server:sha-864d4117fde5dcb6a1fc5519e227992a0a2db462`;
  the live container uses index digest `sha256:66323d934238ae58de8a106fd405e3c2c549e489450c0d74dffd5f0241a4c48d`.
  The app-owned deployer applied OpenCrane revision 15 and PostgreSQL revision 20 as chart 0.9.1.
  Every pod is Running or Succeeded, public `/healthz` returns `{"status":"ok","db":true}`, and
  `/api/v1/auth/login` redirects to Zitadel client `384935596856002567` with the testv4 callback.
  data: the exact `0.8.0-to-0.9.0` history row remains present, three invitations remain pending,
  one onboarding is completed, and no personal Agent or agent-session conversation exists yet.
- friction: the first 0.9.2 attempt reached failed PostgreSQL revision 19 because an unchanged-schema
  transition dropped the carried-forward migration proof required by the privileges hook. Jente
  explicitly selected a test-only 0.9.1 overwrite; the replacement release reused the approved
  migration identity, and the privileges Job then completed without database fabrication.
- lesson: a same-schema patch must retain enough reviewed lineage for privilege reconciliation, and
  an image publication report must distinguish the OCI index digest from its Linux child manifest.
- open: Jente must reopen a current `/invite?token=...` link after the rollout cleared the in-memory
  OIDC session, complete the Zitadel return, and let `/api/v1/organization/members/invitations/accept`
  create the active membership. That authenticated request is also the remaining live proof for the
  personal-Agent repair trigger; do not infer it from health or database readiness alone.

## 2026-08-21 · dev · testlynn durable-execution preflight · 2339c9460f6bd775466de4a18d66f0e0381fe748 · FAILED

- findings: config: the deploy agent followed the removed checked-in `Chart.lock` model and stopped
  before invoking the app-owned deploy script. Testlynn remained healthy and unchanged at OpenCrane
  revision 4 and PostgreSQL revision 6; no backup, migration fence, or rollback began.
- friction: agent and package documentation still required `helm dependency build` even though the
  repository now ignores those derived files and packages every in-repo `file://` chart through the
  current-source helper.
- lesson: treat the checked-out commit as chart authority and run the app-owned current-source
  packaging helper before deployment; never promote ignored `Chart.lock` or `charts/` output into a
  second release contract.

## 2026-08-21 · dev · testlynn durable-execution operand reconciliation · 78ff3cb2ddbbcf4df74095e36620434d2c549f7e · FAILED

- findings: chart: CloudNativePG rejected the manifest-bound digest-only PostgreSQL operand because
  it cannot detect upgrades from an image reference without a tag. The app-owned deployer fenced the
  server at OpenCrane revision 5, stopped before database mutation, and rolled the application release
  back to revision 4 content; Helm recorded that rollback as revision 6. PostgreSQL revision 7 records
  the rejected upgrade, while the existing CNPG Cluster remains healthy with one ready primary and all
  application Deployments remain available.
- friction: repository validation proved only digest immutability and did not model CloudNativePG's
  separate tag requirement, so CI accepted a reference the live admission webhook rejects.
- lesson: bind CNPG operand images with a PostgreSQL-version-prefixed tag whose major matches the
  chart's `externalAppVersion`, plus an immutable digest. Reject tag-only, digest-only, unversioned-tag,
  and wrong-major references before publication.

## 2026-08-21 · dev · testlynn durable-execution PostgreSQL configuration · 25ff6a318b58fd3a8d11168f34e42784bf74ecf6 · FAILED

- findings: chart: CloudNativePG accepted the version-prefixed, digest-bound PostgreSQL operand, then
  rejected `shared_preload_libraries` under `.spec.postgresql.parameters`. [CloudNativePG 1.27](https://cloudnative-pg.io/docs/1.27/postgresql_conf/)
  treats it as a fixed parameter in that map and accepts additional libraries through
  `.spec.postgresql.shared_preload_libraries`. The app-owned deployer fenced the server at OpenCrane
  revision 7, stopped before backup or database mutation, and restored revision 6 content.
- friction: the Helm render test asserted the PostgreSQL setting but did not assert which
  CloudNativePG API field carried it, so a syntactically valid render reached the live admission webhook.
- lesson: render additional preload libraries through `.spec.postgresql.shared_preload_libraries` and
  keep ordinary PostgreSQL settings, such as `cron.database_name`, in the parameter map.

## 2026-08-21 · dev · testlynn durable-execution backup gate · ba9d49bf2eab20763c3e5e30319d6d595212e0b6 · FAILED

- findings: infra: the PostgreSQL 17.5 operand reconciliation completed and its replacement primary
  became ready with `pg_cron` preloaded. The migration then stopped because testlynn has no chart-owned
  plugin-backed `ScheduledBackup`; the application rollback restored revision 8 before any backup or
  database migration ran. The cluster has neither the Barman Cloud plugin API nor a
  `VolumeSnapshotClass`. The current chart supports only plugin-backed backup, so no
  repository-supported recovery provider is currently available.
- friction: the deployer discovered the missing backup provider only after it fenced the application
  and reconciled the PostgreSQL operand, even though the `ScheduledBackup` prerequisite was read-only
  and could have been checked before either action.
- lesson: preflight live-Cluster backup capability before the application fence, then recheck it when
  creating the immediate recovery backup. Never translate approval for the schema transition into an
  unbacked-migration override.

## 2026-08-31 · dev · testv4 central-authorization upgrade · e5a9a3a35792e66766a5fb211aa3e6273a812da6 · FAILED

- findings: codebase: PostgreSQL revision 64 stopped in `20260829000000_central_authorization_authority`
  when the provider-identity backfill updated a referenced `ModelDefinition` and the existing
  immutability trigger rejected it. The migration transaction fully rolled back, and no application
  rollout began. script: the failed central-migration ledger row requires a bounded
  `migrate resolve --rolled-back` before the next deploy can pass Prisma's failed-migration gate.
- friction: the authorized identity rewrite crossed a target immutability guard that the migration
  left active, while migrator recovery covered only the earlier workflow-cutover migration.
- lesson: fixed by PR #752.

## 2026-08-31 · dev · testv4 central-authorization retry · 031449ef74beb411565f28593198421860d037c8 · FAILED

- findings: config: the central authorization migration completed and retired its obsolete tables,
  but PostgreSQL revisions 67 and 70 failed because the database-privileges hook still selected the
  obsolete `opencrane-database-proof` ComputeClass. No node matched, scale-up hit capacity and quota
  failures, and both Jobs exhausted their 930-second deadlines before application rollout.
- friction: preflight accepted a selector that required unavailable dedicated capacity, costing two
  full hook deadlines after the database migration had already succeeded.
- lesson: fixed by PR #752.

## 2026-08-31 · dev · testv4 central-authorization network-policy gate · f773912c7baadbf8b57ec8f8f8e957c5d89d72f8 · FAILED

- findings: chart: PostgreSQL revision 73 and its selector-free two-container privileges hook
  completed, but the application render required four `cilium.io/v2` `CiliumNetworkPolicy`
  resources that GKE Dataplane V2 does not expose. Helm rejected the unsupported resources before
  applying application revision 35, so revision 34 remained installed. data: Prisma has no
  unfinished migration, the five retired tables remain absent, and the retired invocation and
  dependent-record counts remain zero.
- friction: live GKE evidence confirmed standard `NetworkPolicy` enforcement, while preflight
  recognized neither the `anetd` DaemonSet nor a rendered custom policy API that the target cluster
  cannot serve.
- lesson: express the warm-runtime label-and-port rules through portable
  `networking.k8s.io/v1` `NetworkPolicy`; installing a CRD without its enforcement controller would
  only hide the incompatibility.

## 2026-08-31 · dev · fleet policy decision · 9715dedbb1f6e1c2c357615a20160c88343840b8 · LIVE

- findings: policy: pre-1.0 baseline-only decision approved by Jente Rosseel — the platform keeps a
  single fresh-install authority (`apps/opencrane/prisma/bootstrap/target-baseline.sql`) and no
  reviewed version-to-version upgrade paths until the MVP release. testv4 (schema 0.9.0, live
  invitations and onboarding data), testlynn (schema 0.9.0, four failed 0.9.3 attempts), and testv3
  (pre-ledger baseline `22cd09a9`, no `opencrane_migrations.schema_history`) are **rebuild, not
  upgrade**: the accepted path to a newer schema on these silos is teardown plus a fresh install,
  and the data loss is explicitly accepted.
- friction: the version-train machinery (transition SQL, digest contracts, per-version manifests)
  made every schema change a multi-file ceremony while no external user depends on an upgrade path.
- lesson: do not attempt an in-place schema upgrade on any dev silo while the pre-1.0 policy stands;
  rebuild instead. Upgrade contracts return at MVP, most likely as a Prisma-ledger migrator Job.

## 2026-09-06 · render-only · testv5 KurrentDB backup and restore qualification · PR #826 · PARTIAL

- findings: chart: the KurrentDB plane now renders TLS `GET /health/live` readiness and liveness
  probes, a `minAvailable: 1` PodDisruptionBudget, and the `<release>-kurrentdb-backup` CronJob in
  `fileCopy` (default) or `volumeSnapshot` mode with `values.schema.json` coverage; the Helm
  contract, workload-ownership, module-growth, and release-versioning gates pass on the default,
  history-store, and develop-smoke value sets. script: `k8s-deploy.sh --kurrentdb-restore` builds its
  restore Job from the CronJob's own jobTemplate, refuses a serving ledger without
  `--kurrentdb-restore-confirm-serving`, keeps a pre-restore safety copy, and re-runs the bootstrap
  Job; proven only against mocked kubectl/helm in `kurrentdb-restore-contract.sh`. docs: the
  KurrentDB 26.0 guide marks online file copies as possibly inconsistent for secondary-index files
  (secondary indexing is on by default) and recommends volume snapshots; the dev GKE cluster had no
  `VolumeSnapshotClass` on 2026-08-31, so `fileCopy` is the shipped default. Recovery objectives with
  the default schedule: RPO 24 h plus run time, RTO unmeasured (expected minutes for 20Gi).
- friction: no offline evidence exists that `/health/live` answers anonymously under
  `AllowAnonymousEndpointAccess=false`; the official secure-cluster compose examples probe it without
  credentials, which is the basis for the HTTPS probes. A 3-node topology stays unrendered because
  per-node advertised hostnames, gossip seeds, and a wildcard node certificate are not produced yet.
- lesson: the live testv5 drill must (1) confirm the probes report Ready on 26.1.1 with anonymous
  endpoint access disabled, (2) run one scheduled `fileCopy` backup and one `--kurrentdb-restore
  latest` end to end and record the measured RTO, (3) create a `VolumeSnapshotClass` on the dev
  cluster and repeat the drill in `volumeSnapshot` mode, and (4) verify that the restored node
  accepts the copied secondary-index files or document disabling secondary indexing.

## 2026-09-07 · live preflight · testv5 recovery drill · f1a01fbf5 · PARTIAL

- findings: infra: the active context is `gke_weownai-proto_europe-west1_opencrane-dev`.
  A live namespace inventory contains testv3, testv4, testlynn, and testjos, but no testv5.
  `kubectl get volumesnapshotclasses.snapshot.storage.k8s.io` returns no classes. No backup or
  restore has run, so RTO remains unmeasured and anonymous KurrentDB health remains unproven.
- findings: infra: the Agent Sandbox controller has one available replica, uses the immutable
  `sha256:ba381b4e0c86cca597d5c5a31860e38d30ec1c45e0a7a8328bb2799c87d059c0` image, and enables
  the extensions reconciler. This confirms only that prerequisite, not a working conversation.
- friction: the handoff describes a testv5 drill but the target silo has not been installed on
  this context. The install requires its own identity configuration and namespace-local bootstrap
  credentials before a scheduled backup can exist.
- lesson: establish the fresh-install inputs and supported script path first, then record a real
  scheduled backup, restore, health probe, and measured RTO. Keep snapshot qualification pending
  until a suitable VolumeSnapshotClass is available through the authorized infrastructure path.

## 2026-09-07 · CI fresh install · conversation workspace · 0a4a7c98d83d8e1a59e4e6307924ae4a35be00bd · FAILED

- findings: codebase: [qualification run 34112859323](https://github.com/elewa-git/opencrane/actions/runs/34112859323)
  passed the source, SQL, KurrentDB and image-build checks, then failed its k3d fresh install.
  The server crashed because its production workspace install omitted `@kurrent/kurrentdb-client`.
  Cognee recovered from the unavailable HuggingFace tokenizer and reached Ready; it was not a
  second deployment blocker. Publication was skipped, so this run produced no candidate images.
- friction: the client was declared at the repository root, which made builds and source tests pass
  while leaving it out of the server's production dependency manifest.
- lesson: declare the KurrentDB client in the server workspace and extend the existing Docker import
  check so image construction catches this failure before a cluster rollout. Qualify the repaired
  SHA before publication. This throwaway CI run supplies no testv5 recovery or authenticated-journey proof.

## 2026-09-07 · CI fresh install · current-silo qualification · 54970839a6e6dda3e29aa546c0796691465ab45d · FAILED

- findings: config: [qualification run 34115181543](https://github.com/elewa-git/opencrane/actions/runs/34115181543)
  reached server configuration after the client packaging repair, then failed because the old smoke
  profile enabled neither required KurrentDB configuration nor an Agent Sandbox profile. script:
  the parallel source job also exposed an agent-controller Helm contract that depended on another
  test populating the checkout's generated chart directory. Publication remained blocked.
- friction: the fresh-install step spent 16m41s before reporting the missing history configuration;
  the full run took 19m35s. PR source checks on this SHA passed independently, illustrating why their
  success does not establish installation readiness.
- lesson: isolate chart fixtures (`874181a01`) and render the exact smoke profile in local contracts.
  The repaired smoke installs TLS KurrentDB and the pinned Sandbox controller, builds the bootstrap
  image from its app-owned Dockerfile, and uses immutable images in a disposable registry. It must
  prove anonymous health, denied anonymous data reads and authenticated service reads in CI before
  publication. Its explicit runc profile supplies no gVisor, backup/restore, or user-journey proof.

## 2026-09-07 · CI fresh install · TLS ledger startup · 12de455f86a72f4e24d8f3c3909a3b5753d01d14 · FAILED

- findings: chart: [qualification run 34118015985](https://github.com/elewa-git/opencrane/actions/runs/34118015985)
  passed the other selected qualification jobs, then failed its fresh install. KurrentDB loaded the
  server certificate from its trusted-root directory and rejected it because it was not self-signed.
  The server could not connect to the crashing ledger. Publication remained blocked.
- friction: the fresh-install step spent 17m51s before returning the certificate error. Render checks
  had verified that TLS inputs existed without checking what the trusted-root directory contained.
- lesson: project only `ca.crt` into the trusted-root mount and keep the node certificate and key
  in their own mount. Parse the rendered StatefulSet in the Helm contract to guard this boundary,
  then qualify the repaired SHA before publication. Preflight against KurrentDB 26.1.1 also showed
  that bootstrap's HTTP stream routes require `KURRENTDB_ENABLE_ATOM_PUB_OVER_HTTP=true`, which
  defaults to false; enable it while retaining TLS, authentication, and the existing private network
  boundary. Bootstrap now reads the latest settings event as JSON instead of searching an HTTP feed
  whose embedded data is a string, and its contract rejects changed permissions even when an older
  matching ACL is nested in the response. The final service probe requests JSON explicitly, and
  subscription retries inspect `/info` instead of consuming activation messages. No testv5 drill
  or user journey has run.

## 2026-09-07 · dev prerequisite · GKE PD snapshot class · 74599200d6d46bbab5ca982d5e42cb375fe317d3 · LIVE

- findings: infra: the deploy entrypoint created `opencrane-pd-snapshots` at 12:19:36 UTC on
  `gke_weownai-proto_europe-west1_opencrane-dev`. The class uses `pd.csi.storage.gke.io` with
  `Delete` policy and no default-class annotation. Its ownership labels are
  `app.kubernetes.io/managed-by=opencrane-prerequisite-bootstrap` and
  `opencrane.ai/prerequisite=gke-pd-snapshot-class`.
- command: `apps/_infra/deploy-k8s/platform/k8s-deploy.sh --provision-gke-snapshot-class opencrane-pd-snapshots --context gke_weownai-proto_europe-west1_opencrane-dev --storage-class standard-rwo`.
  The identical action then reported an existing valid class. Readback at 12:20:36 UTC retained
  UID `06a3c519-d969-4755-9980-50c3722898c4`, resource version `1788783576490431004`, and generation 1.
  Both actions exited successfully; the retry changed no resource.
- lesson: the missing snapshot class was a provisioning gap that the authorized script could
  resolve, not a missing operator decision. Only that class was created. Testv5 still needs its
  identity configuration and fresh installation; no scheduled backup, restore, measured RTO,
  cloud snapshot readiness, or authenticated user journey is established by this prerequisite.

## 2026-09-07 · CI fresh install · native history authentication · 08e3d27450c777e5b6dbee0308a29139087e5b83 · FAILED

- findings: codebase: [qualification run 34121485088](https://github.com/elewa-git/opencrane/actions/runs/34121485088)
  brought KurrentDB to readiness and completed bootstrap in 44 seconds, including current ACL
  verification and the authenticated service probe. Server startup then received `AccessDeniedError`
  on the silo sentinel read. The pinned native client retains percent encoding in URL credentials,
  so generated password characters such as `+` and `/` reached authentication as `%2B` and `%2F`.
- friction: the fresh-install step spent 19m08s before returning the failure. A local TLS probe
  using the actual installed client reproduced the incorrect password bytes without Docker.
- lesson: supply raw credentials through the SDK provider and keep them out of the URL. The
  regression observes the real native request over verified TLS. The subsequent first-read path
  also needs the history port's empty result for never-written streams: normalize that SDK error
  while preserving authentication, transport, deletion, malformed-event and cancellation failures.
  PR CI on this SHA passed all 24 jobs plus two configured skips; full qualification still blocked
  publication. No testv5 recovery or authenticated user journey has run.

## 2026-09-07 · CI fresh install · conversation workspace · 574673d5f52f2d92dfb823c90259283c17470a2c · LIVE

- findings: [full qualification and publication run 34125652718](https://github.com/elewa-git/opencrane/actions/runs/34125652718)
  passed all 25 selected jobs, including all 13 image publications; one configured job was skipped.
  Source checks, fresh PostgreSQL authority proofs, real KurrentDB proofs, five image smokes, API
  synchronization and the k3d installation passed without validation overrides. Storybook affected
  detection ran but selected no component execution in this manual run. The separate
  [PR run 34125286532](https://github.com/elewa-git/opencrane/actions/runs/34125286532) passed 24 jobs,
  including its browser checks, with two configured skips; its complete rollup had 31 successful
  checks and two skips.
- images: registry inspection verified all 13 `sha-574673d5f52f2d92dfb823c90259283c17470a2c`
  tags, immutable Linux/amd64 manifests and matching OCI revision labels. The smoke built separate
  images from that same source before publication; deployment of the published digests remains
  testv5 work. The full qualification/publication run took 13m26s.
- timing: the k3d smoke step ran from 13:09:24 to 13:18:41 UTC (9m17s). Installation began at
  13:15:44.873; KurrentDB rollout completed at 13:17:40.475, bootstrap completion was observed at
  13:17:44.936 and server availability at 13:18:05.482. The application became available about
  2m21s after installation began. These are disposable CI measurements, not testv5 recovery timing
  or a controlled before/after benchmark.
- proof: with TLS verification and anonymous endpoint/stream access disabled, the smoke asserted
  anonymous `/health/live` returned 200/204, anonymous administration and sentinel reads returned
  401/403, and the history service identity read the sentinel with 200. Individual status codes
  were not printed; the final successful assertion sequence establishes those allowed results.
  Storage qualification expanded a CSI-backed PVC from 64Mi to 128Mi. Agent Sandbox used the
  explicit runc profile. This run did not qualify gVisor, an authenticated assistant turn, scheduled
  KurrentDB backups, snapshot creation/restoration, or either recovery mode on testv5.
- follow-up: preparation of the cloud drill caught invalid uppercase timestamps in both scheduled
  and safety VolumeSnapshot names. `1867e416f` corrects those two naming paths; the rendered backup
  script and actual restore safety manifest pass name-validation regressions. The deploy entrypoint
  also exposes the existing namespace credential helpers as explicit actions, preserving ordinary
  install validation and credential reuse. These later script/chart changes have separate focused
  contract and independent-review evidence; they are not part of this CI installation's source SHA.

## 2026-09-07 · live setup · testv5 identity, DNS and provider · a74c3caf2 · PARTIAL

- findings: config: the user supplied the ignored repository credentials for Zitadel and OpenAI.
  Their validity was checked without printing or committing values. Zitadel has a dedicated
  `OpenCrane testv5` confidential web client, authorization-code flow with `client_secret_post`,
  exact callback `https://testv5.dev.opencrane.ai/api/v1/auth/callback` and logout origin.
  App-local hosted Login V2 was enabled at 18:58:30 UTC; its other OIDC fields and both sibling
  applications were unchanged. Three reserved-address test identities have private generated
  passwords and administrator-verified fixture email claims. No notification email was sent,
  existing human credentials changed, or instance-wide login policy modified.
- findings: infra: Cloud DNS change 38 completed at 18:47:09.896 UTC in `opencrane-ai-zone`,
  project `weownai-proto`. It added only `testv5.dev.opencrane.ai A 35.205.225.244`, TTL 300.
  All four authoritative nameservers and public/local recursive resolvers returned that address.
  The wildcard and sibling records were unchanged.
- findings: provider: a direct OpenAI request to `gpt-4.1-nano-2025-04-14` returned HTTP 200 and
  the expected marker in 2.806s, using 25 input and 5 output tokens. This establishes the key and
  upstream model only; no provider registration or assistant turn through OpenCrane is proven.
- findings: infra: the 18:42–18:46 UTC preflight reverified shared controllers, Sandbox v1beta1
  CRDs, gVisor, published images and the snapshot class. No testv5 namespace existed. Regional
  SSD usage was 1190/1200Gi, while standard-disk usage was 0/4096Gi. The existing `standard`
  class uses the legacy in-tree provisioner; it cannot supply the required CSI snapshot proof.
- lesson: identity inputs were already available in ignored `keys/` dotfiles. Inspect authorized
  local secret sources before reporting missing operator input. Use a non-default CSI standard-disk
  class through the owning deploy action to fit available quota, and record that disk type with
  recovery timing. Installation, product authentication, provider registration and both drills remain
  pending; this setup entry establishes none of them.

## 2026-09-07 · dev prerequisite and preflight · testv5 standard disks · bd85bdde36c33ee048cb912483851d96a986262c · PARTIAL

- findings: infra: the explicit deploy action created `opencrane-pd-standard` at 19:01:19 UTC on
  `gke_weownai-proto_europe-west1_opencrane-dev`. The non-default class uses
  `pd.csi.storage.gke.io`, `pd-standard`, expansion, `WaitForFirstConsumer` and `Delete` policy.
  An identical retry retained UID `668aaeac-aa1e-4b99-ac15-01ce1d34bf42` and resource version
  `1788807679616239015`. Existing disks and default classes were unchanged.
- findings: config: the deploy entrypoint's PostgreSQL and KurrentDB credential actions completed
  successfully for `opencrane-testv5`. Its namespace now exists with dedicated PostgreSQL bootstrap
  credentials and immutable KurrentDB TLS, service and bootstrap credentials. Generated test login
  credentials are retained in the ignored private testv5 key directory, with directory mode 0700
  and file mode 0600; no credential values belong in this ledger.
- findings: script: preflight began at 19:03:26 UTC and exited before Helm installation because
  the wrapper's JSONPath conversion produced literal newline escapes instead of controller
  arguments. It reported a missing extensions reconciler although the live, Ready controller's
  argument array was `["--leader-elect=true","--extensions"]`.
- lesson: inspect the Deployment JSON argument array directly and test exact membership through
  the public wrapper. A text-formatting failure must not trigger unnecessary controller changes.
  The application images, public TLS endpoint, authenticated product and recovery remain unqualified
  on testv5; no installation or restore command ran in this attempt.

## 2026-09-07 · dev fresh install · testv5 bootstrap DNS failure · 219e701879a94304e9b4f3d7cf5134b2bad52c95 · PARTIAL

- timing: preflight passed in 49.114s at 19:11:13 UTC. Installation ran from 19:11:41.513 to
  19:25:53.866 UTC (852.349s), using the qualified `574673d5f` application images. PostgreSQL
  privileges completed in 26s; all requested standard-disk PVCs bound. Application resources were
  admitted at 19:14:50–53. KurrentDB became Ready at 19:17:08, with zero restarts. ACME completed
  and public TLS validated. Public health remained HTTP 503; all-Pods-Ready and the five-minute
  readiness target were not achieved.
- findings: chart: the bootstrap Pod started at 19:15:56 after a 59.775s image-pull wait, of which
  downloading took 2.177s. Scoped Cloud Logging recovered repeated DNS-resolution failures for the
  private KurrentDB service from 19:16:08 through 19:20:49. The cluster uses node-local resolver
  `169.254.20.10` with GKE DNS cache and `ADVANCED_DATAPATH`; the bootstrap NetworkPolicy allowed
  only the `kube-dns` Pod selector. Bootstrap reached `FailureTarget` at 19:20:21 and `Failed` at
  19:20:53 because of its 330-second deadline. Its Pod was deleted by the Job controller. The
  server could not read its silo stream and restarted with `AccessDeniedError`.
- findings: script: the installer waited only for Job completion, then lost the failed command's
  status after its `if` block. Interrupting that local wait produced exit 0 and an installed message
  despite failed bootstrap and public HTTP 503. The final workload list also omitted the actual
  `opencrane-server` Deployment. Repairs add terminal-failure detection, correct failure propagation,
  the server readiness wait and an explicit release-owned bootstrap retry.
- findings: recovery: the first scheduled file-copy attempt refused the uninitialised data volume
  because `writer.chk` was absent. Its automatic retry succeeded at 19:17:08; the next scheduled
  Job succeeded at 19:20:12. These pre-fixture backups establish no product-data recovery or RTO.
  KurrentDB's three insecure/anonymous flags are false and anonymous HTTPS probes succeed; direct
  response-code verification, product login, AI registration and both recovery drills remain pending.
- lesson: configure exact resolver host CIDRs for the restricted bootstrap and snapshot Jobs. Treat
  terminal bootstrap failure as failed installation immediately, retain cloud logs when deadline
  handling removes the Pod, and retry the same release's verification Job after applying the repair.

## 2026-09-07 · dev repair · testv5 repeat-install inputs · a925aa61e17822d276a4dc443d05287f85fadfd4 · PARTIAL

- timing: preflight passed from 19:51:53.779 to 19:53:01.034 UTC (67.254s). The repair command
  ran from 19:53:33.774 to 19:55:41.958 UTC (128.184s), exiting 1 before application Helm apply.
  PostgreSQL reconciliation and privileges passed with existing credentials retained.
- findings: config: the test launcher repeated its fresh-install `--values` file. The standalone
  first-owner guard rejected it because that input could replace the immutable issuer binding.
  The DNS repair therefore did not land; the bootstrap policy still lacked `169.254.20.10/32`.
  Existing-release recovery must retain stored values and supply the specific DNS change through
  the supported `--set-string` input, with the same first-owner and OIDC coordinates.
- findings: script: inspection also found the existing-release credential-consumer rollout waiting
  for the server before the final bootstrap check. Moving the bootstrap check immediately after
  successful Helm apply makes terminal failure visible before this dependent rollout wait.
- lesson: distinguish fresh-install profile inputs from a repeat invocation. Validate the bootstrap
  before waiting for the server that depends on it. This attempt performed no bootstrap retry,
  successful public-health check, authenticated product journey or restore.

## 2026-09-07 · dev repair · testv5 bootstrap ownership · 8747c67d6da67e9a6697663266b901c74afd641f · PARTIAL

- CI: [Actions run 34157671053](https://github.com/elewa-git/opencrane/actions/runs/34157671053)
  completed with 24 successful checks and two configured skips at this SHA. That result precedes
  the subsequent bootstrap ownership repair and does not establish live application readiness.
- timing: application repair ran from 20:00:47.575 to 20:04:02.965 UTC (195.391s). Helm revision 2
  was applied at 20:03:20. The installer then exited 1 on the existing terminal bootstrap failure,
  before entering the dependent server rollout wait, as intended.
- findings: config: the live bootstrap policy now permits DNS to `169.254.20.10/32`. Readback
  confirmed the first-owner and complete OIDC binding were unchanged. The private launcher now
  supplies its values file only on fresh installation and preserves stored values on repeat runs.
- findings: script: the explicit bootstrap retry ran from 20:05:34.231 to 20:05:36.153 UTC
  (1.923s), refusing the Job before mutation. The guard required a release-instance label on parent
  metadata, but the actual chart places that label on the Pod template. Both the bootstrap Job and
  Ready KurrentDB StatefulSet have that layout. The Job's Helm release/namespace annotations and
  component label were correct, and neither resource was deleting.
- lesson: test recovery ownership against actual rendered resources, including Helm ownership
  annotations, rather than a handwritten fixture with invented parent labels. Align the guard with
  the emitted release identity while preserving foreign-resource denial. Public API readiness,
  authenticated journeys and both recovery modes remain pending.

## 2026-09-07 · dev proof · testv5 anonymous KurrentDB health · PASS

- proof: at 20:11:31–32 UTC, unauthenticated requests returned `/health/live` 204, `/users` 401
  and `/streams/opencrane-silo/0` 401. All curl commands exited 0 with the public CA and exact
  service-hostname verification; no authentication header was supplied.
- identity: the Ready Pod had zero restarts and reported version `26.1.1.3690` in its startup log.
  Its image ID matched the pinned KurrentDB digest
  `sha256:e5c9d59716174a4a47f9d54d6ce45aaaca48114b7ee668135aeb9f16934d74c8`.
  `INSECURE`, `ALLOW_ANONYMOUS_ENDPOINT_ACCESS` and `ALLOW_ANONYMOUS_STREAM_ACCESS` were all false.
- boundary: the temporary local port-forward closed at 20:11:32.872 UTC. This read-only proof
  establishes the required health/authentication behavior; application bootstrap, user journeys
  and backup restoration are separate, still-pending results.

## 2026-09-07 · dev recovery · testv5 installation and identity · 98767e5fc440e9a9e6c42fcfebf791fc21b70df1 · LIVE with product proof pending

- timing: the explicit release-owned bootstrap retry succeeded from 20:16:56.386 to
  20:17:13.038 UTC (16.651s). Job `c656a943-081b-43d3-af78-b0cdba4241bf` completed at 20:17:10.
  Normal installation verification then succeeded from 20:18:29.474 to 20:23:26.508 UTC
  (297.034s). Helm revision 3 was applied at 20:21:02. The first verified public TLS `/healthz`
  response was 200 at 20:21:26.784. These are repair timings, not a successful fresh-install
  measurement against the five-minute target.
- proof: independent readback at 20:24:54 found all 11 Pods Ready with zero restarts across the
  application, artifacts and scanning namespaces. Running image references matched the qualified
  `574673d5f52f2d92dfb823c90259283c17470a2c` build. The first-owner and OIDC bindings were retained.
- identity: the dedicated owner completed password-verified OIDC and the normal OpenCrane PKCE
  callback at 20:23:05. Two dedicated colleagues then completed the same login and accepted
  owner-created invitations. Each colleague was denied onboarding before acceptance and admitted
  afterward; both Active Member roles were confirmed by 20:25:49. No real user's identity or
  credentials were changed. This proves authenticated API admission; browser onboarding remains
  a separate acceptance check.
- findings: codebase: initial provider registration remained pending after LiteLLM 1.81.0 returned
  an embedded string-code 404 from credential PATCH under HTTP 200. The adapter treated transport
  success as mutation success and skipped creation. Repair `585d23dc2` requires explicit success,
  creates only after confirmed absence, and retains uncertainty for malformed responses. Independent
  review passed with 186 focused tests and both package lint checks. That application repair is
  pushed but is not yet published or deployed.
- findings: product: the owner approved a persona and resumed the guided answers, but onboarding
  completion awaits a configured default model. A three-person group was created; its first human
  message returned 503. At 20:40:41 the normal history service identity could read its genesis and
  bounded stream, while its encrypted-payload count remained zero. The message failure is therefore
  being diagnosed before or within payload persistence, separately from the missing-model barrier.
- boundary: no completed assistant answer, reviewed child-chat return, authenticated browser reload,
  or data-bearing backup restore is established by this run. Both recovery drills remain pending.

## 2026-09-07 · dev repair · testv5 provider and message diagnosis · ea0ba66c32a3891012a4474607c69d85e0831aef · PARTIAL

- CI: [Actions run 34161718885](https://github.com/elewa-git/opencrane/actions/runs/34161718885)
  passed 25 jobs with one configured skip and published all 13 deployable images. Daemon-free
  manifest inspection verified their Linux amd64 image revision labels against this SHA.
- timing: the owning install command with verification ran from 21:24:35.461 to 21:28:29.007 UTC
  (233.547s), exiting 0. The server became Ready at 21:28:01 and public TLS health returned 200
  at 21:28:26.681. At 21:29:12, all 11 Pods were Ready without restarts; seven running application
  image IDs matched the publication receipt. This measures repair, not fresh installation.
- inputs: the immutable first-owner/OIDC binding and the existing conversation were retained.
  The completed bootstrap Job retained its previously qualified utility image, explicitly pinned
  independently of application images; its Pod template was not patched. The PostgreSQL operand
  retained the current release manifest's image. Neither is evidence that the new images ran.
- identity: all three dedicated users repeated normal password-verified OIDC admission by 21:30:30.
  All three had approved personas and saved guided answers; the two colleagues had also passed
  fresh-read resume and duplicate-answer checks. Completion still needs a usable default model.
- findings: codebase: the credential response repair now reaches a successful LiteLLM credential
  creation. The next read fails because `/model/info` returns 500 before any model exists. At
  21:50:38.187, an authenticated read of the pinned proxy's `/v2/model/info` returned 200 with an
  empty `data` array. The adapter repair uses that endpoint and preserves failures for unavailable
  or malformed inventory; no error response is interpreted as an empty catalogue.
- findings: codebase: the group's message still returned 503 at 21:31:05 and persisted no payload.
  Source diagnosis found Conversation Use, an effect action, passed to the authority's read-only
  entitlement listing. Repair must separate pure eligibility decisions from effect admission and
  record message admission alongside encrypted payload persistence in the same transaction.
- boundary: personal answers, ordinary group messages, company-assistant child answers, reviewed
  sharing and data-bearing restores remain unproven. Browser login stopped before password entry;
  the automatic approval reviewer rejected placing the fixture password on the system clipboard.
  No password was copied, and the authenticated API evidence does not establish browser completion.


## 2026-09-07 · dev acceptance · testv5 provider and human group · cf8b5f44759f19a01d03e9d3534e7a8b2aab3811 · PARTIAL

- outcome: employees can authenticate through the dedicated Zitadel client and exchange durable
  messages in an ordinary group. The supplied AI provider is configured through protected product
  APIs, with one tenant model selected. Personal and company assistant execution remain unqualified.
- CI: [Actions run 34166048987](https://github.com/elewa-git/opencrane/actions/runs/34166048987)
  passed 25 jobs with two configured skips and published all 13 deployable images. All Linux amd64
  manifests carry this exact source revision. Image-smoke qualification reused the unchanged chart's
  successful k3d evidence from run 34161718885; it did not run another current-silo k3d installation.
  Build/test/lint took 129 seconds, fresh-database checks 51 seconds and KurrentDB proofs 60 seconds.
- deployment: the owning install command with verification ran from 22:24:29.157 to 22:28:54.238 UTC
  (265.081 seconds), exiting 0 at Helm revision 5. The server became Ready at 22:28:05; public TLS
  health returned 200 at 22:28:26.009. At 22:29:34.405, all 11 Pods were Ready with zero restarts,
  and seven running application image IDs matched the publication receipt. This is repair timing.
- retained inputs: the first-owner/OIDC binding is unchanged. The completed bootstrap Job keeps
  its separately qualified utility digest `sha256:5e702899c3a504ea69df94250a8889b02d3108c5357c7fc6de050b60236205fe`;
  the PostgreSQL operand keeps the release manifest's image. Publication of replacement images
  does not establish that they ran. Bootstrap update preparation remains unexercised live.
- identity and provider: all three fixture users completed fresh password-verified OIDC admission
  by 22:30:16.928. At 22:30:30.954, the original provider command returned configured and registered.
  The first `testv5/gpt-4.1-nano` model, routed to `openai/gpt-4.1-nano-2025-04-14`, was created and
  selected as the tenant default with successful readback at 22:30:33.853. No provider key, OIDC
  secret or session cookie is recorded in source or this ledger.
- human group: by 22:30:41, all three members read the same three ordered human messages from
  KurrentDB-backed history. An exact message retry kept its original position; changed text with
  the same command key returned 409. The ordinary group has no computer, agent service or run.
- findings: codebase: onboarding conclusion returned 503 at 22:31:06 because initial-publication
  authorization rejected grants activated by the later database transaction clock. The repair
  stamps newly reconciled grants with the trusted operation time and retains existing validity,
  revocation and deny rules. It still needs live completion proof.
- findings: codebase: company setup returned 503 at 22:35:31. PostgreSQL rejected its Internal
  Principal under `principals_identity_check`: the repository supplied an issuer other than the
  reserved `urn:opencrane:agent-service`. The repair follows the existing schema, without changing it.
- session limitation: successful server replacement loses current logins. Source inspection confirms
  `express-session` uses its default process-local MemoryStore; preserving the signing secret does
  not preserve session contents. Durable sessions, interrupted login continuity and multiple-server
  behavior require a separate implementation and proof.
- boundary: no personal answer, company child answer, reviewed return, browser password completion,
  data-bearing restore or RTO is established here. Scheduled fileCopy backups succeed, but neither
  recovery drill has restored the completed product fixture. The earlier browser clipboard rejection
  remains in force; authenticated API login is not browser completion evidence.


## 2026-09-08 · source gate · first assistant admission · PARTIAL

- candidate: `5681f1cae2d7811903d2eae23665fab1f3209791` passed
  [Actions run 34167722856](https://github.com/elewa-git/opencrane/actions/runs/34167722856):
  24 successful jobs, two configured skips and all 13 deployable publications. Daemon-free
  inspection verified every Linux amd64 manifest's source revision. It was not deployed.
- findings: codebase: checking the next first-run path before rollout found product resource
  admissions labelled as workload decisions without a Pod identity. The current database correctly
  rejects those rows. Personal resource admission now names the human Principal; managed resource
  admission names the company assistant's Principal with the existing agent-service actor class.
  Human invocation and conversation access keep their separate requester decisions. Actual runtime
  workload guards are unchanged; no workload evidence is fabricated.
- regression scope: tests traverse the central authority, Prisma decision recorder and audit writer
  for personal and company resource admission, company child resolution and company run evidence.
  They verify persisted actor classes and identifiers and denial when a different Principal alone
  has Model Use. These are source tests, not completed live model turns.
- deployment decision: the next application repair will use the supported server-only image flag,
  retaining the already qualified companion images. Record the server's source separately; a mixed
  repair installation is not an exact-SHA release qualification.
