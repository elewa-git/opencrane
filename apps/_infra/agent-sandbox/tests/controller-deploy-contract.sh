#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEPLOY="$ROOT_DIR/apps/_infra/agent-sandbox/deploy-controller.sh"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
BIN_DIR="$FIXTURE_DIR/bin"
mkdir -p "$BIN_DIR"
CALLS="$FIXTURE_DIR/calls"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'output=""' 'while [[ $# -gt 0 ]]; do if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi; done' 'printf "%s\n" "args:" "        - --extensions" "        image: registry.k8s.io/agent-sandbox/agent-sandbox-controller:v0.5.3" > "$output"' 'printf "curl-output=%s\n" "$output" >> "$FAKE_CALLS"' > "$BIN_DIR/curl"
printf '%s\n' '#!/usr/bin/env bash' 'if [[ "${FAKE_BAD_HASH:-false}" == "true" ]]; then printf "%s  %s\n" bad "$3"; else printf "%s  %s\n" e21a561002a800f78d05d45cb80d773f1651ba6cc0e2b6b9d5110846db031c4d "$3"; fi' > "$BIN_DIR/shasum"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'printf "kubectl=%s\n" "$*" >> "$FAKE_CALLS"' 'if [[ "$*" == "config current-context" ]]; then printf "%s\n" "${FAKE_CURRENT_CONTEXT}"; elif [[ "$*" == *" get crd "* ]]; then printf "%s\n" "v1beta1:true:true"; fi' > "$BIN_DIR/kubectl"
chmod +x "$BIN_DIR/curl" "$BIN_DIR/shasum" "$BIN_DIR/kubectl"

bash -n "$DEPLOY"
if PATH="$BIN_DIR:$PATH" FAKE_CALLS="$CALLS" FAKE_CURRENT_CONTEXT=other "$DEPLOY" --context opencrane-dev 2>/dev/null; then
	echo "Installer accepted a mismatched current context." >&2
	exit 1
fi
! grep -Fq ' apply ' "$CALLS"

: > "$CALLS"
PATH="$BIN_DIR:$PATH" FAKE_CALLS="$CALLS" FAKE_CURRENT_CONTEXT=opencrane-dev "$DEPLOY" --context opencrane-dev --preflight >/dev/null
manifest_path="$(sed -n 's/^curl-output=//p' "$CALLS")"
[[ ! -e "$(dirname "$manifest_path")" ]]
! grep -Fq ' apply ' "$CALLS"

if PATH="$BIN_DIR:$PATH" FAKE_CALLS="$CALLS" FAKE_CURRENT_CONTEXT=opencrane-dev FAKE_BAD_HASH=true "$DEPLOY" --context opencrane-dev --preflight 2>/dev/null; then
	echo "Installer accepted a manifest checksum mismatch." >&2
	exit 1
fi

: > "$CALLS"
PATH="$BIN_DIR:$PATH" FAKE_CALLS="$CALLS" FAKE_CURRENT_CONTEXT=opencrane-dev "$DEPLOY" --context opencrane-dev >/dev/null
grep -Fq 'kubectl=--context opencrane-dev apply --server-side --field-manager=opencrane-agent-sandbox' "$CALLS"
grep -Fq 'kubectl=--context opencrane-dev rollout status deployment/agent-sandbox-controller --namespace agent-sandbox-system --timeout=180s' "$CALLS"
[[ "$(grep -Fc 'kubectl=--context opencrane-dev get crd ' "$CALLS")" == "4" ]]

if "$DEPLOY" --context 2>"$FIXTURE_DIR/missing-value"; then
	echo "Installer accepted --context without a value." >&2
	exit 1
fi
grep -Fq -- '--context requires a value' "$FIXTURE_DIR/missing-value"

echo "Agent Sandbox controller deploy contract: PASS"
