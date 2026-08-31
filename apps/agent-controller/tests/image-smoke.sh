#!/usr/bin/env bash
set -euo pipefail

image="opencrane-agent-controller:smoke"
runtime_log="$(mktemp)"
trap 'rm -f "$runtime_log"' EXIT

docker build -t "$image" -f apps/agent-controller/deploy/Dockerfile .
set +e
docker run --rm --network none "$image" >"$runtime_log" 2>&1
runtime_result=$?
set -e

if test "$runtime_result" -eq 0; then
  cat "$runtime_log" >&2
  printf "agent controller unexpectedly started without configuration\n" >&2
  exit 1
fi
if grep -Fq "ERR_MODULE_NOT_FOUND" "$runtime_log"; then
  cat "$runtime_log" >&2
  exit 1
fi
first_config_error="$(grep -oE '[A-Z][A-Z0-9_]+ is required' "$runtime_log" | head -n 1 || true)"
if test "$first_config_error" != "OPENCRANE_CONTROLLER_TOKEN_PATH is required"; then
  cat "$runtime_log" >&2
  printf "agent controller did not reach its first required configuration check\n" >&2
  exit 1
fi
printf "offline agent-controller startup reached its first required configuration check\n"
