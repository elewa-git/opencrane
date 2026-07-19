#!/usr/bin/env bash
# Prove the direct-refactor residue guard rejects discarded transition-program vocabulary.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/phase-a-forbidden-references.sh"
TMP_DIR="$(mktemp -d)"

cleanup()
{
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/docs/agents"
printf '%s\n' '# Empty exact inventory for the isolated guard test.' >"$TMP_DIR/docs/agents/legacy-linkerd-inventory.txt"
printf '%s\n' '# Baseline' >"$TMP_DIR/README.md"

git -C "$TMP_DIR" init -q
git -C "$TMP_DIR" add README.md docs/agents/legacy-linkerd-inventory.txt
git -C "$TMP_DIR" -c user.name=guard-test -c user.email=guard@example.invalid -c commit.gpgsign=false commit -qm baseline

(cd "$TMP_DIR" && "$GUARD" >/dev/null)

mkdir -p "$TMP_DIR/docs/design"
printf '%s\n' '# Probe' 'Reintroduce a frozen-blue release.' >"$TMP_DIR/docs/design/probe.md"
git -C "$TMP_DIR" add docs/design/probe.md

output="$(cd "$TMP_DIR" && "$GUARD" 2>&1 || true)"
if [[ "$output" != *"TRANSITION-PROGRAM"* ]]; then
	printf 'Expected transition-program rejection, got:\n%s\n' "$output" >&2
	exit 1
fi

printf '%s\n' '# Probe' 'Keep this connection path through R9.' >"$TMP_DIR/docs/design/probe.md"
git -C "$TMP_DIR" add docs/design/probe.md
output="$(cd "$TMP_DIR" && "$GUARD" 2>&1 || true)"
if [[ "$output" != *"TRANSITION-PROGRAM"* ]]; then
	printf 'Expected R-gate rejection, got:\n%s\n' "$output" >&2
	exit 1
fi

git -C "$TMP_DIR" rm -qf docs/design/probe.md
mkdir -p "$TMP_DIR/apps/opencrane/prisma/schema"
printf '%s\n' 'model SessionScope {' '  id String @id' '}' >"$TMP_DIR/apps/opencrane/prisma/schema/probe.prisma"
git -C "$TMP_DIR" add apps/opencrane/prisma/schema/probe.prisma
output="$(cd "$TMP_DIR" && "$GUARD" 2>&1 || true)"
if [[ "$output" != *"SESSION-SCOPE"* ]]; then
	printf 'Expected SessionScope schema rejection, got:\n%s\n' "$output" >&2
	exit 1
fi

git -C "$TMP_DIR" rm -qf apps/opencrane/prisma/schema/probe.prisma
mkdir -p "$TMP_DIR/apps/opencrane/src/app"
printf '%s\n' 'export const retiredConsumer = "OPENCRANE_SKILL_REGISTRY_URL";' >"$TMP_DIR/apps/opencrane/src/app/config.ts"
git -C "$TMP_DIR" add apps/opencrane/src/app/config.ts
output="$(cd "$TMP_DIR" && "$GUARD" 2>&1 || true)"
if [[ "$output" != *"SKILL-REGISTRY-CONSUMER"* ]]; then
	printf 'Expected Skill Registry consumer rejection, got:\n%s\n' "$output" >&2
	exit 1
fi

printf 'Phase A forbidden-reference negative test passed.\n'
