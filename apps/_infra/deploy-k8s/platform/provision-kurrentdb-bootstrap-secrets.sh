#!/usr/bin/env bash
# Creates the immutable KurrentDB trust and credential Secrets consumed by one fresh testv5 silo.
# The deployer validates these inputs and never rotates them, so reruns only verify existing state.
set -euo pipefail
umask 077

NAMESPACE=""
RELEASE=""

_err() { echo "[kurrentdb-bootstrap] $*" >&2; }

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
command -v jq >/dev/null || { _err "jq is required."; exit 1; }

TLS_SECRET="${RELEASE}-kurrentdb-tls"
ADMIN_SECRET="${RELEASE}-kurrentdb-bootstrap"
OPS_SECRET="${RELEASE}-kurrentdb-bootstrap-ops"
SERVICE_SECRET="${RELEASE}-kurrentdb-history-service"
secret_directory="$(mktemp -d)"
trap 'rm -rf "$secret_directory"' EXIT

_require_immutable_secret() {
  local secret="$1" type="$2"
  [[ "$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.immutable}')" == "true" ]] || { _err "Existing $secret is not immutable."; exit 1; }
  [[ "$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.type}')" == "$type" ]] || { _err "Existing $secret has the wrong type."; exit 1; }
}

_create_immutable_literal_secret() {
  local secret="$1" type="$2"
  shift 2
  kubectl create secret generic "$secret" -n "$NAMESPACE" --type="$type" "$@" --dry-run=client -o json \
    | jq '.immutable = true' \
    | kubectl create -f - >/dev/null
}

_read_secret_key() {
  local secret="$1" key="$2" destination="$3" encoded
  encoded="$(kubectl get secret "$secret" -n "$NAMESPACE" -o "go-template={{ index .data \"$key\" }}")"
  [[ -n "$encoded" ]] || { _err "Existing $secret has no $key."; exit 1; }
  printf '%s' "$encoded" | base64 -d >"$destination"
  [[ -s "$destination" ]] || { _err "Existing $secret has an empty $key."; exit 1; }
}

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

if kubectl get secret "$TLS_SECRET" -n "$NAMESPACE" >/dev/null 2>&1; then
  _require_immutable_secret "$TLS_SECRET" kubernetes.io/tls
  for key in tls.crt tls.key ca.crt; do
    _read_secret_key "$TLS_SECRET" "$key" "$secret_directory/$key"
  done
  certificate_public_key="$(openssl x509 -in "$secret_directory/tls.crt" -pubkey -noout | openssl pkey -pubin -outform pem)"
  private_public_key="$(openssl pkey -in "$secret_directory/tls.key" -pubout -outform pem)"
  [[ "$certificate_public_key" == "$private_public_key" ]] || { _err "Existing $TLS_SECRET certificate and private key do not match."; exit 1; }
  openssl verify -purpose sslserver -CAfile "$secret_directory/ca.crt" "$secret_directory/tls.crt" >/dev/null || { _err "Existing $TLS_SECRET certificate is not a server certificate signed by its CA."; exit 1; }
  openssl x509 -checkend 0 -noout -in "$secret_directory/tls.crt" >/dev/null || { _err "Existing $TLS_SECRET certificate is expired or not currently valid."; exit 1; }
  expected_service_dns="${RELEASE}-kurrentdb.${NAMESPACE}.svc"
  openssl x509 -checkhost "$expected_service_dns" -noout -in "$secret_directory/tls.crt" >/dev/null || { _err "Existing $TLS_SECRET certificate does not cover $expected_service_dns."; exit 1; }
else
  service_name="${RELEASE}-kurrentdb"
  service_namespace_dns="${service_name}.${NAMESPACE}"
  service_dns="${service_namespace_dns}.svc"
  service_fqdn="${service_dns}.cluster.local"
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -sha256 \
    -subj "/CN=${RELEASE} KurrentDB CA" \
    -keyout "$secret_directory/ca.key" -out "$secret_directory/ca.crt" >/dev/null 2>&1
  openssl req -newkey rsa:3072 -nodes -sha256 -subj "/CN=${service_dns}" \
    -keyout "$secret_directory/tls.key" -out "$secret_directory/tls.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s,DNS:%s,DNS:%s,DNS:%s\nextendedKeyUsage=serverAuth\n' \
    "$service_name" "$service_namespace_dns" "$service_dns" "$service_fqdn" >"$secret_directory/extensions.cnf"
  openssl x509 -req -days 825 -sha256 -in "$secret_directory/tls.csr" \
    -CA "$secret_directory/ca.crt" -CAkey "$secret_directory/ca.key" -CAcreateserial \
    -extfile "$secret_directory/extensions.cnf" -out "$secret_directory/tls.crt" >/dev/null 2>&1
  _create_immutable_literal_secret "$TLS_SECRET" kubernetes.io/tls \
    --from-file="tls.crt=$secret_directory/tls.crt" \
    --from-file="tls.key=$secret_directory/tls.key" \
    --from-file="ca.crt=$secret_directory/ca.crt"
fi

if kubectl get secret "$ADMIN_SECRET" -n "$NAMESPACE" >/dev/null 2>&1; then
  _require_immutable_secret "$ADMIN_SECRET" Opaque
  _read_secret_key "$ADMIN_SECRET" password "$secret_directory/admin-password"
else
  _create_immutable_literal_secret "$ADMIN_SECRET" Opaque --from-literal="password=$(openssl rand -base64 36 | tr -d '\n')"
fi

if kubectl get secret "$OPS_SECRET" -n "$NAMESPACE" >/dev/null 2>&1; then
  _require_immutable_secret "$OPS_SECRET" Opaque
  _read_secret_key "$OPS_SECRET" password "$secret_directory/ops-password"
else
  _create_immutable_literal_secret "$OPS_SECRET" Opaque --from-literal="password=$(openssl rand -base64 36 | tr -d '\n')"
fi

if kubectl get secret "$SERVICE_SECRET" -n "$NAMESPACE" >/dev/null 2>&1; then
  _require_immutable_secret "$SERVICE_SECRET" kubernetes.io/basic-auth
  _read_secret_key "$SERVICE_SECRET" username "$secret_directory/service-username"
  _read_secret_key "$SERVICE_SECRET" password "$secret_directory/service-password"
  [[ "$(<"$secret_directory/service-username")" == "opencrane-history" ]] || { _err "Existing $SERVICE_SECRET has the wrong username."; exit 1; }
else
  _create_immutable_literal_secret "$SERVICE_SECRET" kubernetes.io/basic-auth \
    --from-literal=username=opencrane-history \
    --from-literal="password=$(openssl rand -base64 36 | tr -d '\n')"
fi

echo "[kurrentdb-bootstrap] Immutable KurrentDB Secrets are ready in $NAMESPACE."
