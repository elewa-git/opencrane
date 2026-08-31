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
