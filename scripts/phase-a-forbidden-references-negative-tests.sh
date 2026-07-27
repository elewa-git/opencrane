#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT/libs/util/src/phase-a-legacy-probe.ts"

cleanup()
{
  rm -f "$PROBE"
}
trap cleanup EXIT

printf '%s\n' 'export const legacyProbe = "/auth/pod-token";' >"$PROBE"
if "$ROOT/scripts/phase-a-forbidden-references.sh" >/dev/null 2>&1; then
  printf 'Expected the pre-transformation residue probe to be rejected.\n' >&2
  exit 1
fi

rm -f "$PROBE"
"$ROOT/scripts/phase-a-forbidden-references.sh" >/dev/null
printf 'Pre-transformation residue negative test passed.\n'
