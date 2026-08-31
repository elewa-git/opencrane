#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/agent-domain-boundary.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/libs/backend"
cp -R "$ROOT/libs/backend/agents" "$TMP_DIR/libs/backend/agents"
mkdir -p "$TMP_DIR/libs/backend/server/iam" "$TMP_DIR/libs/backend/server/agents"
cp -R "$ROOT/libs/backend/server/iam/membership" "$TMP_DIR/libs/backend/server/iam/membership"
cp -R "$ROOT/libs/backend/server/iam/authorization" "$TMP_DIR/libs/backend/server/iam/authorization"
cp -R "$ROOT/libs/backend/server/agents/agent-services" "$TMP_DIR/libs/backend/server/agents/agent-services"
cp "$ROOT/tsconfig.json" "$ROOT/eslint.config.mjs" "$TMP_DIR/"

expect_failure()
{
  local expected="$1"
  local output status
  set +e
  output="$(AGENT_DOMAIN_BOUNDARY_ROOT="$TMP_DIR" "$GUARD" 2>&1)"
  status=$?
  set -e
  if [[ $status -eq 0 ]] || ! grep -Fq "$expected" <<<"$output"; then
    printf 'Expected agent-domain boundary failure containing: %s\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

node --input-type=module - "$TMP_DIR" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const path = join(root, "libs/backend/agents/personal/memory/main/project.json");
const project = JSON.parse(readFileSync(path, "utf8"));
project.tags[2] = "scope:personal-archive";
writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`);
NODE
expect_failure "tags must be type:lib, layer:backend, and exactly scope:personal-memory"

cp "$ROOT/libs/backend/agents/personal/memory/main/project.json" "$TMP_DIR/libs/backend/agents/personal/memory/main/project.json"
node --input-type=module - "$TMP_DIR" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const path = join(root, "tsconfig.json");
const config = JSON.parse(readFileSync(path, "utf8"));
config.compilerOptions.paths["@opencrane/backend/agents/execution/runs"] = ["./wrong/current-target.ts"];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE
expect_failure "TypeScript alias @opencrane/backend/agents/execution/runs must resolve exactly"

cp "$ROOT/tsconfig.json" "$TMP_DIR/tsconfig.json"
node --input-type=module - "$TMP_DIR" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const path = join(root, "libs/backend/server/agents/agent-services/main/project.json");
const project = JSON.parse(readFileSync(path, "utf8"));
project.tags[2] = "scope:personal-agent-services";
writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`);
NODE
expect_failure "tags must be type:lib, layer:backend, and exactly scope:agent-services"

printf 'Agent-domain boundary negative tests passed.\n'
