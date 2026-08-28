#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tier3-development-auth.sh"

source "$HELPER"

_validate()
{
  BASE_DOMAIN="${1:-develop-smoke.opencrane.test}"
  TIER3_DEVELOPMENT_AUTH="${2:-0}"
  TIER3_PROXY_SECRET="${3:-}"
  TIER3_SESSION_SECRET="${4:-}"
  OIDC_ISSUER_URL="${5:-}"
  OIDC_CLIENT_ID="${6:-}"
  OIDC_REDIRECT_URI="${7:-}"
  OIDC_CLIENT_SECRET="${8:-}"
  OIDC_SESSION_SECRET="${9:-}"
  validate_tier3_development_auth
}

proxy_secret="tier3-proxy-secret-with-at-least-32-bytes"
session_secret="tier3-session-secret-with-at-least-32-bytes"

_validate
_validate "develop-smoke.opencrane.test" 1 "$proxy_secret" "$session_secret"
if _validate "develop-smoke.opencrane.test" 1 "$proxy_secret"; then
  echo "Tier 3 authentication accepted a partial secret pair" >&2
  exit 1
fi
if _validate "develop-smoke.opencrane.test" 1 "$proxy_secret" "$session_secret" "https://issuer.example"; then
  echo "Tier 3 authentication accepted mixed OIDC configuration" >&2
  exit 1
fi
if _validate "dev.opencrane.ai" 1 "$proxy_secret" "$session_secret"; then
  echo "Tier 3 authentication accepted a public domain" >&2
  exit 1
fi
if _validate "develop-smoke.opencrane.test" 1 "short" "$session_secret"; then
  echo "Tier 3 authentication accepted an undersized secret" >&2
  exit 1
fi
if _validate "develop-smoke.opencrane.test" 0 "$proxy_secret" "$session_secret"; then
  echo "Tier 3 authentication accepted secrets while disabled" >&2
  exit 1
fi

call_log="$(mktemp)"
trap 'rm -f -- "$call_log"' EXIT
kubectl()
{
  printf '%s' "$1" >> "$call_log"
  shift
  printf ' %s' "$@" >> "$call_log"
  printf '\n' >> "$call_log"
  if [[ "$1 $2" == "create secret" ]]; then
    printf '%s\n' "apiVersion: v1" "kind: Secret"
  else
    cat >/dev/null
  fi
}

_validate "develop-smoke.opencrane.test" 1 "$proxy_secret" "$session_secret"
publish_tier3_development_auth_secret "opencrane-develop-smoke"
grep -Fq -- "create secret generic opencrane-tier3-development-auth" "$call_log"
grep -Fq -- "--from-file=proxy-secret=" "$call_log"
grep -Fq -- "--from-file=session-secret=" "$call_log"
grep -Fq -- "apply -f -" "$call_log"
if grep -Fq -- "$proxy_secret" "$call_log" || grep -Fq -- "$session_secret" "$call_log"; then
  echo "Tier 3 authentication exposed a secret through kubectl command arguments" >&2
  exit 1
fi
while IFS= read -r secret_file; do
  if [[ -e "$secret_file" ]]; then
    echo "Tier 3 authentication retained a plaintext secret file" >&2
    exit 1
  fi
done < <(grep -oE -- '--from-file=[^=]+=[^ ]+' "$call_log" | cut -d= -f3)

helm_args=()
append_tier3_development_auth_helm_args
[[ "${helm_args[*]}" == *"global.environment=dev"* ]]
[[ "${helm_args[*]}" == *"clustertenantManager.tier3DevelopmentAuthentication.enabled=true"* ]]
[[ "${helm_args[*]}" == *"clustertenantManager.tier3DevelopmentAuthentication.existingSecret=opencrane-tier3-development-auth"* ]]

TIER3_DEVELOPMENT_AUTH=0
helm_args=()
append_tier3_development_auth_helm_args
[[ ${#helm_args[@]} -eq 0 ]]

echo "Tier 3 development authentication contract: PASS"
