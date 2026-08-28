#!/usr/bin/env bash

TIER3_DEVELOPMENT_AUTH="${OPENCRANE_TIER3_DEVELOPMENT_AUTH:-0}"
TIER3_PROXY_SECRET="${OPENCRANE_TIER3_PROXY_SECRET:-}"
TIER3_SESSION_SECRET="${OPENCRANE_TIER3_SESSION_SECRET:-}"
TIER3_AUTH_SECRET_NAME="opencrane-tier3-development-auth"

validate_tier3_development_auth()
{
  if [[ "$TIER3_DEVELOPMENT_AUTH" != "0" && "$TIER3_DEVELOPMENT_AUTH" != "1" ]]; then
    printf '%s\n' "OPENCRANE_TIER3_DEVELOPMENT_AUTH must be 0 or 1." >&2
    return 1
  fi
  if [[ "$TIER3_DEVELOPMENT_AUTH" == "0" ]]; then
    if [[ -n "$TIER3_PROXY_SECRET" || -n "$TIER3_SESSION_SECRET" ]]; then
      printf '%s\n' "Tier 3 development authentication secrets require OPENCRANE_TIER3_DEVELOPMENT_AUTH=1." >&2
      return 1
    fi
    return 0
  fi
  if [[ "$BASE_DOMAIN" != *.test ]]; then
    printf '%s\n' "Tier 3 development authentication requires a reserved .test base domain." >&2
    return 1
  fi
  if [[ -z "$TIER3_PROXY_SECRET" || -z "$TIER3_SESSION_SECRET" ]]; then
    printf '%s\n' "Tier 3 development authentication requires both generated secrets." >&2
    return 1
  fi
  if (( ${#TIER3_PROXY_SECRET} < 32 || ${#TIER3_SESSION_SECRET} < 32 )); then
    printf '%s\n' "Tier 3 development authentication secrets must each contain at least 32 characters." >&2
    return 1
  fi
  if [[ -n "$OIDC_ISSUER_URL" || -n "$OIDC_CLIENT_ID" || -n "$OIDC_REDIRECT_URI" || -n "$OIDC_CLIENT_SECRET" || -n "$OIDC_SESSION_SECRET" ]]; then
    printf '%s\n' "Tier 3 development authentication cannot be combined with OIDC." >&2
    return 1
  fi
}

publish_tier3_development_auth_secret()
{
  local namespace="$1"
  local secret_dir
  if [[ "$TIER3_DEVELOPMENT_AUTH" == "0" ]]; then
    return 0
  fi
  secret_dir="$(mktemp -d)"
  trap 'rm -rf -- "$secret_dir"' RETURN
  chmod 0700 "$secret_dir"
  printf '%s' "$TIER3_PROXY_SECRET" > "$secret_dir/proxy-secret"
  printf '%s' "$TIER3_SESSION_SECRET" > "$secret_dir/session-secret"
  kubectl create secret generic "$TIER3_AUTH_SECRET_NAME" -n "$namespace" \
    --from-file=proxy-secret="$secret_dir/proxy-secret" \
    --from-file=session-secret="$secret_dir/session-secret" \
    --dry-run=client -o yaml | kubectl apply -f -
}

append_tier3_development_auth_helm_args()
{
  if [[ "$TIER3_DEVELOPMENT_AUTH" == "0" ]]; then
    return 0
  fi
  helm_args+=(
    --set-string "global.environment=dev"
    --set-string "clustertenantManager.tier3DevelopmentAuthentication.enabled=true"
    --set-string "clustertenantManager.tier3DevelopmentAuthentication.existingSecret=$TIER3_AUTH_SECRET_NAME")
}
