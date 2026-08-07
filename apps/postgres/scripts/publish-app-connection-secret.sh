#!/usr/bin/env bash
# Publish the connection Secret consumed by an authority's application workload.
#
# CloudNativePG uses the supplied initdb owner Secret as the authority credential. It does
# not promise a separate `<cluster>-app` Secret, so the installer owns that deterministic
# connection projection. Credential material stays in process memory and stdin: it is never
# placed in a command argument, shell trace, log line, or repository file.
set -euo pipefail

if [[ "$#" -ne 5 && "$#" -ne 6 ]]; then
  echo "Usage: $0 <namespace> <source-basic-auth-secret> <connection-secret> <host> <database> [connection-options]" >&2
  exit 64
fi

NAMESPACE="$1"
SOURCE_SECRET="$2"
CONNECTION_SECRET="$3"
HOST="$4"
DATABASE="$5"
CONNECTION_OPTIONS="${6:-sslmode=disable}"

if [[ "$SOURCE_SECRET" == "$CONNECTION_SECRET" ]]; then
  echo "Source and application connection Secrets must be distinct." >&2
  exit 65
fi

function _url_encode()
{
  local value="$1"
  local encoded=""
  local character
  local character_code
  local index
  local LC_ALL=C

  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    case "$character" in
      [a-zA-Z0-9.~_-])
        encoded+="$character"
        ;;
      *)
        printf -v character_code '%d' "'$character"
        printf -v character '%%%02X' "$character_code"
        encoded+="$character"
        ;;
    esac
  done

  printf '%s' "$encoded"
}

SOURCE_TYPE="$(kubectl get secret "$SOURCE_SECRET" -n "$NAMESPACE" -o jsonpath='{.type}')"
if [[ "$SOURCE_TYPE" != "kubernetes.io/basic-auth" ]]; then
  echo "Source Secret '$SOURCE_SECRET' must have type kubernetes.io/basic-auth." >&2
  exit 65
fi

USERNAME_BASE64="$(kubectl get secret "$SOURCE_SECRET" -n "$NAMESPACE" -o jsonpath='{.data.username}')"
PASSWORD_BASE64="$(kubectl get secret "$SOURCE_SECRET" -n "$NAMESPACE" -o jsonpath='{.data.password}')"
if [[ -z "$USERNAME_BASE64" || -z "$PASSWORD_BASE64" ]]; then
  echo "Source Secret '$SOURCE_SECRET' must contain username and password keys." >&2
  exit 65
fi

if kubectl get secret "$CONNECTION_SECRET" -n "$NAMESPACE" >/dev/null 2>&1; then
  EXISTING_SOURCE="$(kubectl get secret "$CONNECTION_SECRET" -n "$NAMESPACE" -o jsonpath='{.metadata.annotations.opencrane\.ai/credential-source}')"
  if [[ "$EXISTING_SOURCE" != "$SOURCE_SECRET" ]]; then
    echo "Application connection Secret '$CONNECTION_SECRET' is not owned by source Secret '$SOURCE_SECRET'." >&2
    exit 73
  fi
fi

USERNAME="$(printf '%s' "$USERNAME_BASE64" | base64 -d)"
PASSWORD="$(printf '%s' "$PASSWORD_BASE64" | base64 -d)"
ENCODED_USERNAME="$(_url_encode "$USERNAME")"
ENCODED_PASSWORD="$(_url_encode "$PASSWORD")"
ENCODED_DATABASE="$(_url_encode "$DATABASE")"
URI="postgresql://${ENCODED_USERNAME}:${ENCODED_PASSWORD}@${HOST}:5432/${ENCODED_DATABASE}?${CONNECTION_OPTIONS}"
HOST_BASE64="$(printf '%s' "$HOST" | base64 | tr -d '\n')"
PORT_BASE64="$(printf '5432' | base64 | tr -d '\n')"
DATABASE_BASE64="$(printf '%s' "$DATABASE" | base64 | tr -d '\n')"
URI_BASE64="$(printf '%s' "$URI" | base64 | tr -d '\n')"

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: ${CONNECTION_SECRET}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: opencrane-postgres
  annotations:
    opencrane.ai/credential-source: ${SOURCE_SECRET}
type: Opaque
data:
  username: ${USERNAME_BASE64}
  password: ${PASSWORD_BASE64}
  host: ${HOST_BASE64}
  port: ${PORT_BASE64}
  dbname: ${DATABASE_BASE64}
  uri: ${URI_BASE64}
EOF
