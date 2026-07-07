#!/usr/bin/env bash
#
# zitadel-enable-registration.sh — enable the "Allow Register" login policy on the platform
# Zitadel organisation, so the self-serve org-admin signup funnel (the `prompt=create` login
# param + ORG_OWNER grant, both already landed) can actually register new users (#126 / #122).
#
# It authenticates to the Zitadel Management API with the platform service-account key using the
# JWT-bearer profile (the same credential + flow the fleet-manager's ZitadelManagementClient uses:
# apps/fleet-operator/src/infra/zitadel/zitadel-client.ts), then flips `allowRegister` on the
# org's login policy — creating the org-scoped policy if it is still inheriting the instance default.
#
# Idempotent: re-running when registration is already enabled is a no-op that reports so.
#
# Required env:
#   ZITADEL_MGMT_API_URL   Zitadel instance base URL (e.g. https://weownai-oidc-xxxx.zitadel.cloud)
#   ZITADEL_MGMT_SA_KEY    Service-account key JSON (fields: keyId, key (PEM), userId)
# Optional env:
#   ZITADEL_ORG_ID         Target org id (x-zitadel-orgid scope); default = the SA's resource owner org
#
# Deps: bash, curl, jq, openssl, base64.
set -euo pipefail

_err() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v jq      >/dev/null 2>&1 || _err "jq is required"
command -v curl    >/dev/null 2>&1 || _err "curl is required"
command -v openssl >/dev/null 2>&1 || _err "openssl is required"

API_URL="${ZITADEL_MGMT_API_URL:-}"; API_URL="${API_URL%/}"
SA_KEY_JSON="${ZITADEL_MGMT_SA_KEY:-}"
ORG_ID="${ZITADEL_ORG_ID:-}"

[[ -n "$API_URL" ]]     || _err "ZITADEL_MGMT_API_URL is required"
[[ -n "$SA_KEY_JSON" ]] || _err "ZITADEL_MGMT_SA_KEY is required"

# --- 1. Parse the service-account key ---------------------------------------------------------
KEY_ID=$(printf '%s' "$SA_KEY_JSON"  | jq -r '.keyId')
USER_ID=$(printf '%s' "$SA_KEY_JSON" | jq -r '.userId')
PRIVATE_KEY=$(printf '%s' "$SA_KEY_JSON" | jq -r '.key')
[[ -n "$KEY_ID" && "$KEY_ID" != "null" ]]           || _err "service-account key missing 'keyId'"
[[ -n "$USER_ID" && "$USER_ID" != "null" ]]         || _err "service-account key missing 'userId'"
[[ -n "$PRIVATE_KEY" && "$PRIVATE_KEY" != "null" ]] || _err "service-account key missing 'key' (PEM)"

_b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# --- 2. Build + RS256-sign the JWT-bearer assertion (aud = the instance URL) -------------------
NOW=$(date +%s); EXP=$((NOW + 300))
HEADER=$(printf '{"alg":"RS256","kid":"%s"}' "$KEY_ID" | _b64url)
CLAIMS=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%s,"exp":%s}' "$USER_ID" "$USER_ID" "$API_URL" "$NOW" "$EXP" | _b64url)
SIGNING_INPUT="${HEADER}.${CLAIMS}"
SIGNATURE=$(printf '%s' "$SIGNING_INPUT" | openssl dgst -sha256 -sign <(printf '%s' "$PRIVATE_KEY") | _b64url)
ASSERTION="${SIGNING_INPUT}.${SIGNATURE}"

# --- 3. Exchange the assertion for a Management-API access token -------------------------------
TOKEN=$(curl -sS -X POST "${API_URL}/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=${ASSERTION}" \
  --data-urlencode "scope=openid urn:zitadel:iam:org:project:id:zitadel:aud" \
  | jq -r '.access_token // empty')
[[ -n "$TOKEN" ]] || _err "failed to obtain a Management-API access token (check SA key + API URL)"

# Org-scope header: present only when a target org is given (else the SA's own org is used).
ORG_HEADER=(); [[ -n "$ORG_ID" ]] && ORG_HEADER=(-H "x-zitadel-orgid: ${ORG_ID}")

_api() { # _api METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  curl -sS -X "$method" "${API_URL}${path}" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    "${ORG_HEADER[@]}" ${body:+--data "$body"}
}

# --- 4. Read the current login policy; short-circuit if registration is already on -------------
POLICY=$(_api GET "/management/v1/policies/login")
CURRENT=$(printf '%s' "$POLICY" | jq -r '.policy.allowRegister // false')
IS_DEFAULT=$(printf '%s' "$POLICY" | jq -r '.policy.isDefault // false')

if [[ "$CURRENT" == "true" ]]; then
  echo "Allow Register is already enabled on the login policy — nothing to do."
  exit 0
fi

# --- 5. Enable allowRegister. If the org still inherits the instance default, CREATE an
#        org-scoped policy (POST); otherwise UPDATE the existing custom policy (PUT). Zitadel
#        requires the full policy object, so build it from the current values with the one flag flipped.
BODY=$(printf '%s' "$POLICY" | jq -c '.policy
  | { allowUsernamePassword, allowRegister: true, allowExternalIdp, forceMfa, forceMfaLocalOnly,
      passwordlessType, hidePasswordReset, ignoreUnknownUsernames, allowDomainDiscovery,
      disableLoginWithEmail, disableLoginWithPhone, defaultRedirectUri,
      passwordCheckLifetime, externalLoginCheckLifetime, mfaInitSkipLifetime,
      secondFactorCheckLifetime, multiFactorCheckLifetime }
  | with_entries(select(.value != null))')

if [[ "$IS_DEFAULT" == "true" ]]; then
  echo "Org inherits the instance default login policy — creating an org-scoped policy with registration enabled…"
  RESULT=$(_api POST "/management/v1/policies/login" "$BODY")
else
  echo "Updating the org's custom login policy to enable registration…"
  RESULT=$(_api PUT "/management/v1/policies/login" "$BODY")
fi

# A successful create/update returns a details object; surface any error message.
if printf '%s' "$RESULT" | jq -e '.details // .policy // empty' >/dev/null 2>&1; then
  echo "Allow Register enabled."
else
  _err "failed to enable registration: $(printf '%s' "$RESULT" | jq -r '.message // .')"
fi
