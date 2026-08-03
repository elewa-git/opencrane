#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/phase-b-topology.sh"
WORKLOAD_REGISTRY="$ROOT/docs/agents/workload-ownership.json"
APP_SOURCE_REGISTRY="$ROOT/docs/agents/app-source-allowlist.json"
TMP_DIR="$(mktemp -d)"
RENDER_PROBE="$ROOT/apps/_infra/deploy-k8s/templates/phase-b-guard-probe.yaml"
COMPUTED_KIND_PROBE="$ROOT/apps/_infra/deploy-k8s/templates/phase-b-computed-kind-probe.yaml"
RUNTIME_PROBE="$ROOT/libs/server/_infra/http/src/phase-b-runtime-guard-probe.ts"
RUNTIME_COMMAND_PROBE="$ROOT/scripts/phase-b-runtime-command-guard-probe.sh"
RUNTIME_DUPLICATE_PROBE="$ROOT/libs/server/_infra/http/src/phase-b-runtime-duplicate-guard-probe.ts"
RUNTIME_NONPRODUCING_DUPLICATE_PROBE="$ROOT/libs/server/_infra/http/src/phase-b-runtime-nonproducing-duplicate-guard-probe.ts"
APP_SOURCE_PROBE="$ROOT/apps/opencrane/src/phase-b-app-guard-probe.py"
APP_TEST_SOURCE_PROBE="$ROOT/apps/opencrane/src/app/__tests__/phase-b-app-test-guard-probe.py"
BUILD_SOURCE_PROBE="$ROOT/apps/opencrane/src/build/phase-b-build-source-guard-probe.py"
GENERATED_DIST_PROBE="$ROOT/apps/opencrane/dist/phase-b-generated-guard-probe.js"
GENERATED_CACHE_PROBE="$ROOT/apps/opencrane/node_modules/.cache/phase-b-generated-guard-probe.mjs"

cleanup()
{
  rm -f "$RENDER_PROBE" "$COMPUTED_KIND_PROBE" "$RUNTIME_PROBE" "$RUNTIME_COMMAND_PROBE"
  rm -f "$RUNTIME_DUPLICATE_PROBE" "$RUNTIME_NONPRODUCING_DUPLICATE_PROBE"
  rm -f "$APP_SOURCE_PROBE" "$BUILD_SOURCE_PROBE"
  rm -f "$APP_TEST_SOURCE_PROBE"
  rm -f "$GENERATED_DIST_PROBE" "$GENERATED_CACHE_PROBE"
  rmdir "$(dirname "$BUILD_SOURCE_PROBE")" 2>/dev/null || true
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf "$TMP_DIR"; fi
}
trap cleanup EXIT

expect_failure()
{
  local expected="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    printf 'Expected guard failure containing: %s\n' "$expected" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" <<<"$output"; then
    printf 'Guard failed for the wrong reason. Expected: %s\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

mutate_registry()
{
  local action="$1"
  local output="$TMP_DIR/workload-$action.json"
  node --input-type=module - "$WORKLOAD_REGISTRY" "$output" "$action" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output, action] = process.argv;
const registry = JSON.parse(readFileSync(input, "utf8"));

if (action === "delete-runtime")
{
  registry.workloads = registry.workloads.filter(function keep(workload) {
    return workload.id !== "agent-runtime";
  });
}
else if (action === "duplicate-owner")
{
  const duplicate = structuredClone(registry.workloads.find(function find(workload) {
    return workload.id === "opencrane-server";
  }));
  duplicate.id = "phase-b-duplicate-owner-probe";
  duplicate.owner = "apps/opencrane-ui";
  duplicate.source = {
    type: "file",
    path: "apps/opencrane-ui/helm/templates/_deployment.tpl",
    anchor: "kind: Deployment",
  };
  delete duplicate.renderedPodClass;
  delete duplicate.composition;
  registry.workloads.push(duplicate);
  registry.requiredWorkloadIds.push(duplicate.id);
}
else if (action === "missing-owner")
{
  const workload = registry.workloads.find(function find(candidate) {
    return candidate.id === "postgres-database";
  });
  workload.owner = null;
}
else if (action === "invalid-classification")
{
  const workload = registry.workloads.find(function find(candidate) {
    return candidate.id === "postgres-database";
  });
  workload.classification = "unknown";
}
else if (action === "missing-classification-reason")
{
  const workload = registry.workloads.find(function find(candidate) {
    return candidate.id === "postgres-database";
  });
  workload.reason = "";
}
else if (action === "spoof-local-owner")
{
  const workload = registry.workloads.find(function find(candidate) {
    return candidate.id === "opencrane-server";
  });
  workload.localOwner = false;
}
else if (action === "invalid-nested-owner")
{
  const workload = registry.workloads.find(function find(candidate) {
    return candidate.id === "cognee";
  });
  workload.owner = "apps/product/group";
}
else if (action === "empty-runtime")
{
  registry.runtimeConstructs[0].workloadIds = [];
}
else if (action === "duplicate-runtime-anchor")
{
  registry.runtimeConstructs.push({
    path: "libs/server/_infra/http/src/phase-b-runtime-duplicate-guard-probe.ts",
    anchor: "kind: \"Deployment\"",
    workloadIds: ["agent-runtime"],
  });
}
else if (action === "duplicate-nonproducing-anchor")
{
  registry.nonProducingRuntimeMatches.push({
    path: "libs/server/_infra/http/src/phase-b-runtime-nonproducing-duplicate-guard-probe.ts",
    anchor: "kind: \"Deployment\"",
    reason: "Mutation probe: duplicate delete selectors must not share one exemption.",
  });
}
else
{
  throw new Error(`Unknown mutation: ${action}`);
}

writeFileSync(output, `${JSON.stringify(registry, null, 2)}\n`);
NODE
  printf '%s\n' "$output"
}

mutate_app_source_registry()
{
  local output="$TMP_DIR/app-source-invalid-classification.json"
  node --input-type=module - "$APP_SOURCE_REGISTRY" "$output" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const registry = JSON.parse(readFileSync(input, "utf8"));
registry.allowedFiles[0].classification = "unknown";
writeFileSync(output, `${JSON.stringify(registry, null, 2)}\n`);
NODE
  printf '%s\n' "$output"
}

"$GUARD" >/dev/null

printf '%s\n' \
  'apiVersion: apps/v1' \
  'kind: Deployment' \
  'metadata:' \
  '  name: phase-b-guard-probe' \
  'spec:' \
  '  selector:' \
  '    matchLabels: { app: phase-b-guard-probe }' \
  '  template:' \
  '    metadata:' \
  '      labels: { app: phase-b-guard-probe }' \
  '    spec:' \
  '      containers:' \
  '        - name: probe' \
  '          image: busybox:1.36' >"$RENDER_PROBE"
expect_failure "unregistered rendered pod class Deployment/phase-b-guard-probe" "$GUARD"
rm -f "$RENDER_PROBE"

printf '%s\n' \
  '{{- if .Values.phaseBGuardProbe }}' \
  'apiVersion: batch/v1' \
  'kind: {{ "Job" }}' \
  'metadata:' \
  '  name: phase-b-computed-kind-probe' \
  '{{- end }}' >"$COMPUTED_KIND_PROBE"
expect_failure "unregistered computed kind template" "$GUARD"
rm -f "$COMPUTED_KIND_PROBE"

printf '%s\n' \
  'const phaseBGuardKind = "Job";' \
  'export const phaseBGuardProbe = {' \
  '  apiVersion: "batch/v1",' \
  '  kind: phaseBGuardKind,' \
  '};' >"$RUNTIME_PROBE"
expect_failure "computed Kubernetes kind: phaseBGuardKind" "$GUARD"
rm -f "$RUNTIME_PROBE"

printf '%s\n' '#!/usr/bin/env bash' 'kubectl create cronjob phase-b-runtime-command-probe --image=busybox:1.36 --schedule="0 * * * *"' \
  >"$RUNTIME_COMMAND_PROBE"
expect_failure "unregistered runtime or installer workload construct" "$GUARD"
rm -f "$RUNTIME_COMMAND_PROBE"

printf '%s\n' \
  'export const firstProbe = { apiVersion: "apps/v1", kind: "Deployment" };' \
  'export const secondProbe = { apiVersion: "apps/v1", kind: "Deployment" };' >"$RUNTIME_DUPLICATE_PROBE"
registry="$(mutate_registry duplicate-runtime-anchor)"
expect_failure "anchor must occur exactly once, found 2" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"
rm -f "$RUNTIME_DUPLICATE_PROBE"

printf '%s\n' \
  'export const firstDeleteSelector = { apiVersion: "apps/v1", kind: "Deployment" };' \
  'export const secondDeleteSelector = { apiVersion: "apps/v1", kind: "Deployment" };' \
  >"$RUNTIME_NONPRODUCING_DUPLICATE_PROBE"
registry="$(mutate_registry duplicate-nonproducing-anchor)"
expect_failure "anchor must occur exactly once, found 2" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"
rm -f "$RUNTIME_NONPRODUCING_DUPLICATE_PROBE"

mkdir -p "$(dirname "$GENERATED_DIST_PROBE")" "$(dirname "$GENERATED_CACHE_PROBE")"
printf '%s\n' 'export const generatedProbe = { apiVersion: "batch/v1", kind: "Job" };' >"$GENERATED_DIST_PROBE"
printf '%s\n' 'export const generatedCacheProbe = { apiVersion: "v1", kind: "Pod" };' >"$GENERATED_CACHE_PROBE"
"$GUARD" >/dev/null
rm -f "$GENERATED_DIST_PROBE" "$GENERATED_CACHE_PROBE"

printf '%s\n' 'def phase_b_guard_probe():' '    return "substantive app logic"' >"$APP_SOURCE_PROBE"
expect_failure "unregistered implementation source under app root" "$GUARD"
rm -f "$APP_SOURCE_PROBE"

# Tests prove the app composition but do not become part of the deployable
# implementation allowlist. Keep this fixture in the repository-wide test root.
printf '%s\n' 'def phase_b_test_guard_probe():' '    return "test-only logic"' >"$APP_TEST_SOURCE_PROBE"
"$GUARD" >/dev/null
rm -f "$APP_TEST_SOURCE_PROBE"

mkdir -p "$(dirname "$BUILD_SOURCE_PROBE")"
printf '%s\n' 'def phase_b_build_source_probe():' '    return "tracked source, not generated output"' >"$BUILD_SOURCE_PROBE"
expect_failure "unregistered implementation source under app root" "$GUARD"
rm -f "$BUILD_SOURCE_PROBE"
rmdir "$(dirname "$BUILD_SOURCE_PROBE")"

registry="$(mutate_registry delete-runtime)"
expect_failure "required workload registration is missing: agent-runtime" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry duplicate-owner)"
expect_failure "identity 'Deployment/opencrane-server' conflicts" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry missing-owner)"
expect_failure "owner must be one non-empty exact value" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry invalid-classification)"
expect_failure "classification must be 'delete' or 'survivor'" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry missing-classification-reason)"
expect_failure "classified workload needs an exact reason" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry spoof-local-owner)"
expect_failure "localOwner must be derived from the source type" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

registry="$(mutate_registry invalid-nested-owner)"
expect_failure "repository-defined workload needs one apps/<name> or apps/_infra/<name> owner" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

app_source_registry="$(mutate_app_source_registry)"
expect_failure "classification is not an exact direct-refactor class" \
  env PHASE_B_APP_SOURCE_REGISTRY="$app_source_registry" "$GUARD"

registry="$(mutate_registry empty-runtime)"
expect_failure "workloadIds must map the construct to at least one exact owner" \
  env PHASE_B_WORKLOAD_REGISTRY="$registry" "$GUARD"

printf 'Phase B topology negative tests passed (17 rejection paths plus generated-output regression).\n'
