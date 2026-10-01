#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/mcp-file-generator/deploy/Dockerfile"
grep -Eq '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS build$' "$dockerfile"
test "$(grep -Ec '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64}' "$dockerfile")" -eq 2
grep -Fxq 'USER 65532:65532' "$dockerfile"
grep -Fxq 'ENTRYPOINT ["node"]' "$dockerfile"
grep -Fxq 'CMD ["dist/apps/mcp-file-generator/index.js"]' "$dockerfile"
grep -Fq '"adaptedVersion": "0.11.0"' apps/mcp-file-generator/project.json
grep -Fq '"image": "opencrane-mcp-file-generator"' apps/mcp-file-generator/project.json
grep -Fq '"image-smoke"' apps/mcp-file-generator/project.json
grep -Fq 'bash apps/mcp-file-generator/tests/image-smoke.sh' apps/mcp-file-generator/project.json
test -z "$(find apps/mcp-file-generator -maxdepth 2 -type d -name helm -print -quit)"
