#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/workload-ownership-app-composition-boundary.sh"
WORKLOAD_REGISTRY="$ROOT/docs/agents/workload-ownership.json"
APP_SOURCE_REGISTRY="$ROOT/docs/agents/app-source-allowlist.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

expect_failure()
{
  local expected="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ $status -eq 0 ]] || ! grep -Fq "$expected" <<<"$output"; then
    printf 'Expected boundary guard failure containing: %s\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

mutate_workload_registry()
{
  local action="$1"
  local output="$TMP_DIR/workload-$action.json"
  node --input-type=module - "$WORKLOAD_REGISTRY" "$output" "$action" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output, action] = process.argv;
const registry = JSON.parse(readFileSync(input, "utf8"));
if (action === "invalid-owner") registry.workloads.find((workload) => workload.id === "opencrane-server").owner = "libs/backend";
if (action === "unpinned-render") registry.renderProfiles[0].expectedRenderedPodClasses.pop();
if (action === "missing-dynamic-owner") registry.dynamicWorkloads[0].workloadIds = [];
if (action === "stale-composition") registry.workloads.find((workload) => workload.id === "opencrane-server").composition.anchor = "include \"opencrane.removed.deployment\"";
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

registry="$(mutate_workload_registry invalid-owner)"
expect_failure "owner must be one exact apps/<name> or apps/_infra/<name> root" env WORKLOAD_OWNERSHIP_REGISTRY="$registry" "$GUARD"

registry="$(mutate_workload_registry unpinned-render)"
expect_failure "render output is not pinned" env WORKLOAD_OWNERSHIP_REGISTRY="$registry" "$GUARD"

registry="$(mutate_workload_registry missing-dynamic-owner)"
expect_failure "workloadIds must be a non-empty, duplicate-free list" env WORKLOAD_OWNERSHIP_REGISTRY="$registry" "$GUARD"

registry="$(mutate_workload_registry stale-composition)"
expect_failure "source anchor is stale" env WORKLOAD_OWNERSHIP_REGISTRY="$registry" "$GUARD"

app_source_registry="$(mutate_app_source_registry)"
expect_failure "classification is not an app-composition class" env APP_COMPOSITION_SOURCE_REGISTRY="$app_source_registry" "$GUARD"

printf 'Workload-ownership and app-composition boundary negative tests passed.\n'
