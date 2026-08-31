#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/mcp-executor/deploy/Dockerfile"
grep -Eq '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS build$' "$dockerfile"
test "$(grep -Ec '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64}' "$dockerfile")" -eq 2
grep -Fxq 'USER 65532:65532' "$dockerfile"
grep -Fxq 'ENTRYPOINT ["node"]' "$dockerfile"
grep -Fxq 'CMD ["dist/apps/mcp-executor/index.js"]' "$dockerfile"
grep -Fq '"adaptedVersion": "0.10.0"' apps/mcp-executor/project.json
grep -Fq '"image": "opencrane-mcp-executor"' apps/mcp-executor/project.json
