#!/usr/bin/env bash
set -euo pipefail
image='opencrane-mcpb-validator:smoke'
docker build --tag "$image" --file apps/mcpb-validator/deploy/Dockerfile .
[[ "$(docker run --rm --network none --read-only --entrypoint id "$image" -u)" == "65532" ]]
set +e
output="$(docker run --rm --network none --read-only --user 65532:65532 "$image" 2>&1)"
status=$?
set -e
[[ "$status" == "1" ]]
[[ "$output" == '{"component": "mcpb-validator", "event": "assignment_unavailable"}' ]]
