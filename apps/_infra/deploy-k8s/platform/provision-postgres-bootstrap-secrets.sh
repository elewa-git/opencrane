#!/usr/bin/env bash
# Creates the PostgreSQL bootstrap Secrets for one fresh silo; the installer only validates them afterwards.
# It is deliberately separate from k8s-deploy.sh: the installer validates these credentials
# and never rotates or repairs them.
set -euo pipefail
umask 077

NAMESPACE=""
RELEASE=""

_err() { echo "[postgres-bootstrap] $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    -h|--help) echo "Usage: $0 --namespace NAMESPACE --release RELEASE"; exit 0 ;;
    *) _err "Unknown flag: $1"; exit 1 ;;
  esac
done

[[ -n "$NAMESPACE" && -n "$RELEASE" ]] || { _err "--namespace and --release are required."; exit 1; }
command -v kubectl >/dev/null || { _err "kubectl is required."; exit 1; }
command -v openssl >/dev/null || { _err "openssl is required."; exit 1; }

_secret_name() { printf '%s-%s-postgres-bootstrap' "$RELEASE" "$1"; }
_ensure_secret() {
  local authority="$1" username="$2" secret password
  secret="$(_secret_name "$authority")"
  if kubectl get secret "$secret" -n "$NAMESPACE" >/dev/null 2>&1; then
    [[ "$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.type}')" == "kubernetes.io/basic-auth" ]] || { _err "Existing $secret has the wrong type."; exit 1; }
    [[ "$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.data.username}' | base64 -d)" == "$username" ]] || { _err "Existing $secret has the wrong username."; exit 1; }
    [[ -n "$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.data.password}')" ]] || { _err "Existing $secret has no password."; exit 1; }
    return
  fi
  password="$(openssl rand -base64 36 | tr -d '\n')"
  kubectl create secret generic "$secret" -n "$NAMESPACE" --type=kubernetes.io/basic-auth \
    --from-literal=username="$username" --from-literal=password="$password" >/dev/null
}

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
_ensure_secret opencrane opencrane
_ensure_secret litellm litellm
_ensure_secret admin opencrane_database_admin
echo "[postgres-bootstrap] Bootstrap Secret authorities are ready in $NAMESPACE."
