#!/usr/bin/env bash
# Proves reruns accept one valid immutable KurrentDB authority set and reject corrupt trust or credentials.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/provision-kurrentdb-bootstrap-secrets.sh"
TEST_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
FIXTURES="$TEST_DIRECTORY/fixtures"
mkdir -p "$TEST_DIRECTORY/bin" "$FIXTURES"

service_name="opencrane-testv5-kurrentdb"
service_dns="${service_name}.opencrane-testv5.svc"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -sha256 -subj '/CN=test CA' \
  -keyout "$TEST_DIRECTORY/ca.key" -out "$TEST_DIRECTORY/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 -subj "/CN=$service_dns" \
  -keyout "$TEST_DIRECTORY/tls.key" -out "$TEST_DIRECTORY/tls.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$service_dns" >"$TEST_DIRECTORY/extensions.cnf"
openssl x509 -req -days 2 -sha256 -in "$TEST_DIRECTORY/tls.csr" -CA "$TEST_DIRECTORY/ca.crt" \
  -CAkey "$TEST_DIRECTORY/ca.key" -CAcreateserial -extfile "$TEST_DIRECTORY/extensions.cnf" \
  -out "$TEST_DIRECTORY/tls.crt" >/dev/null 2>&1

base64 <"$TEST_DIRECTORY/tls.crt" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.crt"
base64 <"$TEST_DIRECTORY/tls.key" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.key"
base64 <"$TEST_DIRECTORY/ca.crt" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.ca.crt"
printf 'cGFzc3dvcmQ=' >"$FIXTURES/opencrane-testv5-kurrentdb-bootstrap.password"
printf 'cGFzc3dvcmQ=' >"$FIXTURES/opencrane-testv5-kurrentdb-bootstrap-ops.password"
printf 'b3BlbmNyYW5lLWhpc3Rvcnk=' >"$FIXTURES/opencrane-testv5-kurrentdb-history-service.username"
printf 'cGFzc3dvcmQ=' >"$FIXTURES/opencrane-testv5-kurrentdb-history-service.password"

cat >"$TEST_DIRECTORY/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == create && "$2" == namespace ]]; then printf 'kind: Namespace\n'; exit 0; fi
if [[ "$1" == apply ]]; then cat >/dev/null; exit 0; fi
[[ "$1" == get && "$2" == secret ]] || exit 1
secret="$3"
arguments="$*"
if [[ "$arguments" == *"{.immutable}"* ]]; then printf true; exit 0; fi
if [[ "$arguments" == *"{.type}"* ]]; then
  case "$secret" in
    *-tls) printf kubernetes.io/tls ;;
    *-history-service) printf kubernetes.io/basic-auth ;;
    *) printf Opaque ;;
  esac
  exit 0
fi
for key in tls.crt tls.key ca.crt username password; do
  if [[ "$arguments" == *"\"$key\""* ]]; then
    fixture="$KURRENTDB_FIXTURES/$secret.$key"
    [[ -f "$fixture" ]] && cat "$fixture"
    exit 0
  fi
done
exit 0
MOCK
chmod +x "$TEST_DIRECTORY/bin/kubectl"

PATH="$TEST_DIRECTORY/bin:$PATH" KURRENTDB_FIXTURES="$FIXTURES" bash "$HELPER" \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null

openssl genrsa -out "$TEST_DIRECTORY/wrong.key" 2048 >/dev/null 2>&1
base64 <"$TEST_DIRECTORY/wrong.key" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.key"
if PATH="$TEST_DIRECTORY/bin:$PATH" KURRENTDB_FIXTURES="$FIXTURES" bash "$HELPER" \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null 2>"$TEST_DIRECTORY/mismatch.error"; then
  echo 'KurrentDB provisioner accepted a mismatched TLS private key.' >&2
  exit 1
fi
grep -Fq 'certificate and private key do not match' "$TEST_DIRECTORY/mismatch.error"

base64 <"$TEST_DIRECTORY/tls.key" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.key"
: >"$FIXTURES/opencrane-testv5-kurrentdb-bootstrap.password"
if PATH="$TEST_DIRECTORY/bin:$PATH" KURRENTDB_FIXTURES="$FIXTURES" bash "$HELPER" \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null 2>"$TEST_DIRECTORY/password.error"; then
  echo 'KurrentDB provisioner accepted an empty administrator password.' >&2
  exit 1
fi
grep -Fq 'has no password' "$TEST_DIRECTORY/password.error"

printf 'subjectAltName=DNS:%s\nextendedKeyUsage=clientAuth\n' "$service_dns" >"$TEST_DIRECTORY/client-extensions.cnf"
openssl x509 -req -days 2 -sha256 -in "$TEST_DIRECTORY/tls.csr" -CA "$TEST_DIRECTORY/ca.crt" \
  -CAkey "$TEST_DIRECTORY/ca.key" -CAcreateserial -extfile "$TEST_DIRECTORY/client-extensions.cnf" \
  -out "$TEST_DIRECTORY/client.crt" >/dev/null 2>&1
base64 <"$TEST_DIRECTORY/client.crt" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.crt"
printf 'cGFzc3dvcmQ=' >"$FIXTURES/opencrane-testv5-kurrentdb-bootstrap.password"
if PATH="$TEST_DIRECTORY/bin:$PATH" KURRENTDB_FIXTURES="$FIXTURES" bash "$HELPER" \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null 2>"$TEST_DIRECTORY/purpose.error"; then
  echo 'KurrentDB provisioner accepted a client-only certificate for its TLS server.' >&2
  exit 1
fi
grep -Fq 'is not a server certificate signed by its CA' "$TEST_DIRECTORY/purpose.error"
echo 'KurrentDB bootstrap Secrets contract: PASS'
