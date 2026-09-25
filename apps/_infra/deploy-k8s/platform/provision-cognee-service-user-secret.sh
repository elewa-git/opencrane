#!/usr/bin/env bash
# Creates one immutable, namespace-local Cognee service-user credential for a fresh silo.
set -euo pipefail
umask 077

CONTEXT=""
NAMESPACE=""
SECRET_NAME=""
SERVICE_EMAIL=""
ASSUME_YES=0

fail()
{
  printf '[cognee-service-user] %s\n' "$1" >&2
  exit 1
}

usage()
{
  cat <<'USAGE'
Usage: provision-cognee-service-user-secret.sh \
  --context CONTEXT \
  --namespace NAMESPACE \
  --secret SECRET \
  --email EMAIL \
  --yes

Creates or verifies one immutable Opaque Secret with exact email and password
keys. Every target coordinate and the non-interactive confirmation are required.
USAGE
}

set_once()
{
  local option="$1" current_value="$2" supplied_value="$3"
  [[ -z "$current_value" ]] || fail "$option may be supplied only once"
  [[ -n "$supplied_value" && "$supplied_value" != --* ]] || fail "$option needs a value"
}

parse_args()
{
  if [[ $# -eq 1 && ( "$1" == "--help" || "$1" == "-h" ) ]]; then
    usage
    exit 0
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --context)
        [[ $# -ge 2 ]] || fail "--context needs a value"
        set_once --context "$CONTEXT" "$2"
        CONTEXT="$2"
        shift 2
        ;;
      --namespace)
        [[ $# -ge 2 ]] || fail "--namespace needs a value"
        set_once --namespace "$NAMESPACE" "$2"
        NAMESPACE="$2"
        shift 2
        ;;
      --secret)
        [[ $# -ge 2 ]] || fail "--secret needs a value"
        set_once --secret "$SECRET_NAME" "$2"
        SECRET_NAME="$2"
        shift 2
        ;;
      --email)
        [[ $# -ge 2 ]] || fail "--email needs a value"
        set_once --email "$SERVICE_EMAIL" "$2"
        SERVICE_EMAIL="$2"
        shift 2
        ;;
      --yes)
        [[ "$ASSUME_YES" == "0" ]] || fail "--yes may be supplied only once"
        ASSUME_YES=1
        shift
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$CONTEXT" ]] || fail "--context is required"
  [[ -n "$NAMESPACE" ]] || fail "--namespace is required"
  [[ -n "$SECRET_NAME" ]] || fail "--secret is required"
  [[ -n "$SERVICE_EMAIL" ]] || fail "--email is required"
  [[ "$ASSUME_YES" == "1" ]] || fail "--yes is required"
}

validate_coordinates()
{
  [[ "$CONTEXT" != *$'\n'* && "$CONTEXT" != *$'\r'* ]] || fail "--context contains a line break"
  [[ "$NAMESPACE" =~ ^opencrane-[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || fail \
    "--namespace must be an opencrane-* DNS label"
  [[ ${#NAMESPACE} -le 63 ]] || fail "--namespace exceeds the Kubernetes DNS-label limit"
  [[ "$SECRET_NAME" == "${NAMESPACE}-cognee-service-user" ]] || fail \
    "--secret must be <namespace>-cognee-service-user"
  [[ ${#SECRET_NAME} -le 253 ]] || fail "--secret exceeds the Kubernetes DNS-subdomain limit"
  [[ "$SERVICE_EMAIL" =~ ^[A-Za-z0-9.!#$%\&\'*+/=?^_\`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] || fail \
    "--email is malformed"
}

require_commands()
{
  local command_name
  for command_name in kubectl jq openssl; do
    command -v "$command_name" >/dev/null 2>&1 || fail "missing required command: $command_name"
  done
}

validate_context()
{
  local current_context
  if ! current_context="$(kubectl config current-context 2>/dev/null)"; then
    fail "could not read the current kubectl context"
  fi
  [[ "$current_context" == "$CONTEXT" ]] || fail \
    "kubectl context is '$current_context', expected '$CONTEXT'"
}

read_namespace_uid()
{
  local snapshot_file="$1" namespace_name namespace_label namespace_uid retirement_owner
  if ! kubectl --context "$CONTEXT" get namespace "$NAMESPACE" \
      --ignore-not-found --output=json >"$snapshot_file" 2>"$PRIVATE_DIRECTORY/namespace-read.err"; then
    fail "could not read namespace '$NAMESPACE'; absence was not proven"
  fi
  [[ -s "$snapshot_file" ]] || fail \
    "namespace '$NAMESPACE' does not exist; create it through the silo bootstrap first"

  namespace_name="$(jq -r '.metadata.name // ""' "$snapshot_file")"
  namespace_label="$(jq -r '.metadata.labels["kubernetes.io/metadata.name"] // ""' "$snapshot_file")"
  namespace_uid="$(jq -r '.metadata.uid // ""' "$snapshot_file")"
  retirement_owner="$(jq -r '.metadata.labels["opencrane.ai/retirement-owner"] // ""' "$snapshot_file")"
  [[ "$namespace_name" == "$NAMESPACE" && "$namespace_label" == "$NAMESPACE" && -n "$namespace_uid" ]] || fail \
    "namespace '$NAMESPACE' does not have its exact Kubernetes identity metadata"
  [[ -z "$retirement_owner" || "$retirement_owner" == "$NAMESPACE" ]] || fail \
    "namespace '$NAMESPACE' has conflicting OpenCrane ownership"
  printf '%s' "$namespace_uid"
}

read_secret_snapshot()
{
  local snapshot_file="$1"
  if ! kubectl --context "$CONTEXT" --namespace "$NAMESPACE" get secret "$SECRET_NAME" \
      --ignore-not-found --output=json >"$snapshot_file" 2>"$PRIVATE_DIRECTORY/secret-read.err"; then
    fail "could not read Secret '$SECRET_NAME'; absence was not proven"
  fi
}

validate_secret_snapshot()
{
  local snapshot_file="$1"
  jq -e \
    --arg namespace "$NAMESPACE" \
    --arg secret "$SECRET_NAME" \
    --arg email "$SERVICE_EMAIL" \
    '(.apiVersion == "v1")
      and (.kind == "Secret")
      and (.metadata.namespace == $namespace)
      and (.metadata.name == $secret)
      and ((.metadata.uid // "") | length > 0)
      and ((.metadata.ownerReferences // []) | length == 0)
      and ((.metadata.deletionTimestamp // "") == "")
      and (.metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-deploy-bootstrap")
      and (.metadata.labels["app.kubernetes.io/part-of"] == "opencrane")
      and (.metadata.labels["app.kubernetes.io/instance"] == $namespace)
      and (.metadata.labels["app.kubernetes.io/component"] == "cognee-service-user")
      and (.metadata.annotations["opencrane.ai/credential-email"] == $email)
      and (.immutable == true)
      and (.type == "Opaque")
      and ((.data | keys | sort) == ["email", "password"])
      and ((try (.data.email | @base64d) catch "") == $email)
      and ((try (.data.password | @base64d | length) catch 0) > 0)' \
    "$snapshot_file" >/dev/null || fail \
      "existing Secret '$SECRET_NAME' does not match its immutable OpenCrane ownership and key contract"
}

create_secret()
{
  local email_file="$PRIVATE_DIRECTORY/email" password_file="$PRIVATE_DIRECTORY/password"
  printf '%s' "$SERVICE_EMAIL" >"$email_file"
  openssl rand -hex 32 >"$PRIVATE_DIRECTORY/password-with-newline"
  tr -d '\r\n' <"$PRIVATE_DIRECTORY/password-with-newline" >"$password_file"
  grep -Eq '^[[:xdigit:]]{64}$' "$password_file" || fail "openssl returned an invalid password"

  if ! kubectl --context "$CONTEXT" create secret generic "$SECRET_NAME" \
      --namespace "$NAMESPACE" \
      --type=Opaque \
      --from-file="email=$email_file" \
      --from-file="password=$password_file" \
      --dry-run=client \
      --output=json \
    | jq \
        --arg namespace "$NAMESPACE" \
        --arg email "$SERVICE_EMAIL" \
        '.immutable = true
          | .metadata.labels["app.kubernetes.io/managed-by"] = "opencrane-deploy-bootstrap"
          | .metadata.labels["app.kubernetes.io/part-of"] = "opencrane"
          | .metadata.labels["app.kubernetes.io/instance"] = $namespace
          | .metadata.labels["app.kubernetes.io/component"] = "cognee-service-user"
          | .metadata.annotations["opencrane.ai/credential-email"] = $email' \
    | kubectl --context "$CONTEXT" create --filename=- \
        >/dev/null 2>"$PRIVATE_DIRECTORY/secret-create.err"; then
    fail "Secret '$SECRET_NAME' was not created; it may have appeared concurrently"
  fi
}

main()
{
  parse_args "$@"
  validate_coordinates
  require_commands
  validate_context

  PRIVATE_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/opencrane-cognee-service-user.XXXXXX")"
  chmod 700 "$PRIVATE_DIRECTORY"
  trap 'rm -rf "$PRIVATE_DIRECTORY"' EXIT HUP INT TERM

  local initial_namespace_uid current_namespace_uid secret_uid
  initial_namespace_uid="$(read_namespace_uid "$PRIVATE_DIRECTORY/namespace.json")"
  read_secret_snapshot "$PRIVATE_DIRECTORY/secret.json"
  if [[ -s "$PRIVATE_DIRECTORY/secret.json" ]]; then
    validate_secret_snapshot "$PRIVATE_DIRECTORY/secret.json"
  else
    current_namespace_uid="$(read_namespace_uid "$PRIVATE_DIRECTORY/namespace-before-create.json")"
    [[ "$current_namespace_uid" == "$initial_namespace_uid" ]] || fail \
      "namespace '$NAMESPACE' was replaced during credential provisioning"
    create_secret
    read_secret_snapshot "$PRIVATE_DIRECTORY/secret.json"
    [[ -s "$PRIVATE_DIRECTORY/secret.json" ]] || fail \
      "Secret '$SECRET_NAME' was not readable after creation"
    validate_secret_snapshot "$PRIVATE_DIRECTORY/secret.json"
  fi

  current_namespace_uid="$(read_namespace_uid "$PRIVATE_DIRECTORY/namespace-final.json")"
  [[ "$current_namespace_uid" == "$initial_namespace_uid" ]] || fail \
    "namespace '$NAMESPACE' was replaced during credential provisioning"
  secret_uid="$(jq -r '.metadata.uid' "$PRIVATE_DIRECTORY/secret.json")"
  printf '[cognee-service-user] Immutable Secret %s/%s is ready (uid=%s).\n' \
    "$NAMESPACE" "$SECRET_NAME" "$secret_uid"
}

main "$@"
