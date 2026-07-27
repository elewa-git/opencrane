#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERN='feat-openclaw-tenant|feat-central-agents|libs/server/_infra/(tenant-hosting|channel-proxy)|tenant\.opencrane\.io|openclawVersion|OPENCLAW_VERSION|/auth/pod-token|gatewayProxy|fleetManager|linkerd\.io/inject|LINKERD_'

matches="$(
  rg --no-config -n -I -e "$PATTERN" \
    "$ROOT/apps" "$ROOT/libs" "$ROOT/scripts" "$ROOT/.github" \
    "$ROOT/eslint.config.mjs" "$ROOT/package.json" "$ROOT/package-lock.json" \
    --glob '!libs/frontend/state/conversation/render/**' \
    --glob '!libs/frontend/elements/a2ui/**' \
    --glob '!scripts/phase-a-forbidden-references.sh' \
    --glob '!scripts/phase-a-forbidden-references-negative-tests.sh' || true
)"

if [[ -n "$matches" ]]; then
  printf 'Pre-transformation residue remains:\n' >&2
  printf '%s\n' "$matches" >&2
  exit 1
fi

printf 'Pre-transformation implementation residue guard passed.\n'
