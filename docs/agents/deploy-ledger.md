# Deploy ledger — the fleet's memory

Append-only log of deploy runs and what they taught us. The `deploy` agent reads this
**before every run** (so no lesson is rediscovered) and appends after every run. The
`/deploy-loop` skill mines it for configuration-simplification candidates: any friction
item seen in **2+ runs** graduates to a fix PR or an issue.

Keep entries terse — this file is loaded into agent context every run. When a lesson is
fixed at the source (chart/script/docs), rewrite its line to a one-line pointer
(`fixed → PR #NNN`) instead of letting dead advice accumulate. Full run reports do NOT
belong here; they live in the run's PR/issue.

## Format (append one block per run)

```
## <date> · <env> · <profile> · <sha> · <LIVE|PARTIAL|FAILED>
- findings: <class>: one line each, with PR/issue link once filed
- friction: one line each (these accumulate into simplification counters)
- lesson: what the next run must know (flags, ordering, gotchas)
```

## Simplification counters

Friction items seen across runs; bump the count, and when it hits 2, file the fix.

| Friction item | Seen | Status |
|---|---|---|
| _(none yet)_ | | |

## Standing lessons (read these first)

- Dependencies resolve from `Chart.lock` via `helm dep build` — never `dep update`
  during a deploy (reproducibility; see PR #97).
- Values presets live in `libs/k8s-platform/values/` (`opencrane-dev.yaml` is the dev
  cluster). New env knobs belong in a preset, not in one-off `--set` flags.
- Known dev-cluster history (see auto-memory / plan.md): migrate-on-deploy
  initContainer, tenant-pod `trustNothing` config crash, `trustedProxies: []`
  fail-closed — check whether a "new" failure is one of these before diagnosing fresh.

## Runs

## 2026-07-08 · dev · deploy-org-frontend (control-plane SPA) · fff20c16c3f3 · LIVE
- findings: none — clean rollout, all 3 orgs (elewa, northwind, elewa-be) healthy
- friction: deploy-org-frontend.sh is not one of the two mandated profile scripts
  (apps/fleet-platform|clustertenant-platform/deploy.sh) but is the repo's dedicated,
  ledger-documented path for this exact surface — mandate doc should list it explicitly
  alongside the two profile scripts to avoid re-litigating this each run
- lesson: all 3 orgs already had ingress.sameOrigin chart-owned rules (no legacy
  out-of-band ingress patch needed) — confirms the migration from optimalisation-plan.md
  §5 is complete in dev; script's legacy-patch fallback branch is now dead code for
  these orgs and can likely be dropped/flagged once confirmed elsewhere too

## 2026-07-09 · dev · clustertenant-platform (silo: elewa/elewa-be/northwind) · 7a61226 · PARTIAL
- findings: infra: elewa-be + northwind upgrades FAIL outright — `Certificate
  opencrane-clustertenant-tls` in both namespaces exists without Helm ownership
  metadata (created out-of-band 2026-06-29, same minute as elewa's own Helm-owned
  copy); every `helm upgrade` since errors "cannot be imported into the current
  release". Last successful upgrade for both was 2026-07-02 — this has silently
  blocked ~a week of deploys. Fix needs adoption (label/annotate to match elewa's
  metadata, or `helm upgrade --take-ownership` — client is v4.1.4, supports it) but
  k8s-deploy.sh has no raw-helm-flag passthrough to do this through the script.
- findings: codebase: `apps/tenant/deploy/entrypoint.sh` only checks whether the
  OpenClaw binary EXISTS on the PVC before installing — never compares the installed
  `package.json` version to `$OPENCLAW_VERSION`. Result: bumping the pin (2026.6.9 →
  2026.6.11) does NOT upgrade an already-provisioned tenant; elewa's tenant pod
  restarted with `OPENCLAW_VERSION=2026.6.11` in env but is still running openclaw
  2026.6.9 (`cat .../node_modules/openclaw/package.json` confirms). `gateway.reload:
  hot` IS correctly rendered into the ConfigMap by the new control-plane, but its
  effect on an unsupported old binary is unverified.
- findings: script: `--tenant-tag` sets `tenant.image.tag`, a Helm value NO template
  reads. The tenant image is actually pinned via `tenant.defaultImage.tag` (read into
  `TENANT_DEFAULT_IMAGE`), which has no deploy flag and stays on floating `latest`.
  Worked out this run only because `latest` and `sha-7a61226` happen to share a
  digest (docker.yml pushes both on main-merge) + tenant pods use
  `imagePullPolicy: Always`.
- findings: codebase: elewa's `clustertenant-manager` fell into a tight, unthrottled
  reconcile loop after the rolling restart — "reconciling tenant" → "litellm key
  update failed ... Team=elewa" (404) → repeat every ~0.6–1.3s, sustained 10+ min,
  ~282m CPU. Tenant CR settles at `phase=Running` (litellm-key failure is caught and
  tolerated), so the generation/checksum skip-guard in `operator.ts` should apply but
  visibly isn't stopping the loop — needs an operator-side trace with debug logging.
  Likely related to the documented degraded-retry self-heal path having no backoff.
- findings: codebase (minor): tenant pod's 30s contract-re-pull loop
  (`entrypoint.sh:386`) shells out to `curl`, which isn't installed in the
  `node:22-bookworm-slim` runtime stage — every cycle fails
  "curl: command not found"; the contract re-pull feature is a no-op fleet-wide.
- friction: no raw-helm-flag passthrough in k8s-deploy.sh — a sanctioned, non-destructive
  recovery (`--take-ownership`) exists in the installed Helm client but the script can't
  reach it, so an out-of-band-drifted resource permanently blocks scripted deploys.
- friction: `--tenant-tag` is a documented, plausible-looking flag that is dead code
  (2nd distinct "flag looks wired but isn't" finding after the deploy-org-frontend
  mandate-doc gap on 2026-07-08 — different flags, same pattern: worth a lint/test that
  every declared `--set` target actually resolves against `helm template`).
- lesson: before touching elewa-be/northwind again, check every CR the silo chart
  renders (`Certificate`, `Issuer`, etc.) for `app.kubernetes.io/managed-by: Helm` +
  `meta.helm.sh/release-name`/`release-namespace` annotations matching this release —
  a mismatch fails the upgrade before anything else runs, and looks nothing like the
  documented NS-delegation preflight false positive.
- lesson: a successful `helm upgrade` + "successfully rolled out" is NOT proof the
  intended runtime change took effect inside the tenant pod — verify the actual
  installed package version on the PVC, not just the pod's env vars/ConfigMap.

## 2026-07-10 · dev · clustertenant-platform (silo: elewa) · e974df3 · LIVE
- findings: infra: opencrane-dev (gke_weownai-proto_europe-west1-b_opencrane-dev) does NOT
  enforce NetworkPolicy — standard GKE, Autopilot disabled (`autopilot: {}`), no Dataplane V2
  (`networkConfig.datapathProvider` unset, no anetd pods), GKE NetworkPolicy addon off
  (`networkPolicy` field null), no calico/cilium/weave/antrea/kube-router DaemonSet in
  kube-system (matches the deploy script's own preflight probe). PR #178's Cognee
  external-egress carve-out is CORRECTLY SHAPED (verified via `kubectl get networkpolicy -o
  yaml`: `opencrane-elewa-external-egress` podSelector has `app.kubernetes.io/component NotIn
  [cognee]`, port 443 only; `opencrane-elewa-silo-baseline` egress no longer has a bare
  `{port:443}` rule) but is NOT ENFORCED: `kubectl exec` probes from both the Cognee pod and a
  non-Cognee pod (openclaw tenant) reached `https://www.google.com` (200) and `https://1.1.1.1`
  (301) successfully — the split is currently decorative on this cluster. 3 ClusterTenants
  (elewa/elewa-be/northwind) share this cluster's nodes, so this is a fleet-wide gap, not
  specific to this fix. Needs a cluster-level fix (enable the NetworkPolicy addon or Dataplane
  V2 on opencrane-dev) — outside deploy-script scope.
- findings: codebase (known, see 2026-07-09 entry — unchanged): elewa's
  clustertenant-manager fell back into the same unthrottled reconcile loop immediately after
  this restart — "litellm key update failed ... Team=elewa" (404) at ~0.3-0.6s cadence (94
  hits in the last 500 log lines, 316m CPU sustained seconds after rollout). Confirms the
  2026-07-09 finding is still unfixed and reproduces on every operator restart, including
  ones unrelated to litellm.
- findings: chart (minor, pre-existing, not hit by this run): helm history shows revision 27
  (14:53:15, before this session started) failed upgrading `opencrane-cognee` —
  `.spec.template.metadata.annotations.restartedAt: expected string, got
  &value.valueUnstructured{Value:1783684360}` (an unquoted numeric annotation value). Self
  -resolved by revision 28 before this run; flagging in case the `restartedAt` templating
  (PR #177) recurs elsewhere.
- friction: `--preflight`'s NS-delegation check (`dig NS $BASE_DOMAIN`) runs unconditionally
  whenever --base-domain is set, even on a silo upgrade that never reaches ACME/DNS-01
  (cert-manager already installed centrally) — FAILS here because dev.opencrane.ai's records
  live directly in the parent opencrane.ai zone (no separately delegated subzone), a false
  positive already referenced (but not previously detailed) in the 2026-07-09 entry. Does not
  block the actual (non-preflight) apply path, only the advisory `--preflight` run.
- friction: the CNI-enforcement preflight check is only FATAL under `--multi-ct`; nothing in
  the script/docs flags that opencrane-dev already hosts 3 ClusterTenants sharing nodes and
  should probably always run with `--multi-ct` (or the check should key off "more than one
  ClusterTenant namespace already exists on this cluster" rather than a caller-supplied flag).
- lesson: the silo NetworkPolicies are applied imperatively by the operator's own k8s client
  on every ClusterTenant reconcile (`enforceClusterTenantIsolation` in
  apps/clustertenant-operator/src/tenants/operator.ts), not via Helm templates — bumping
  `--control-plane-tag` and letting the `opencrane-clustertenant-manager` pod restart is
  sufficient to pick up a NetworkPolicy-shape change; it re-applies within seconds of pod
  start (no separate reconcile trigger, CR touch, or migration needed).
