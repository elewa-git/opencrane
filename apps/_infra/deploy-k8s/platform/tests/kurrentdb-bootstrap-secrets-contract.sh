#!/usr/bin/env bash
# Proves explicit deploy actions protect generated passwords and validate existing bootstrap credentials.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
TEST_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
FIXTURES="$TEST_DIRECTORY/fixtures"
PRIVATE_TMP="$TEST_DIRECTORY/private"
mkdir -p "$TEST_DIRECTORY/bin" "$FIXTURES" "$PRIVATE_TMP"
REAL_OPENSSL="$(command -v openssl)"
PASSWORD_SENTINEL="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

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
printf '%s\n' "$*" >>"$BOOTSTRAP_KUBECTL_CALLS"
if [[ "$1" == create && "$2" == namespace ]]; then printf 'kind: Namespace\n'; exit 0; fi
if [[ "$1" == apply ]]; then cat >/dev/null; exit 0; fi
if [[ "$1" == create && "$2" == secret && "$3" == generic ]]; then
  password_file="" password_mode="" private_directory_mode=""
  for argument in "$@"; do
    case "$argument" in
      --from-file=password=*) password_file="${argument#--from-file=password=}" ;;
    esac
  done
  [[ -n "$password_file" && "$(<"$password_file")" == "$PASSWORD_SENTINEL" ]]
  if password_mode="$(stat -f '%Lp' "$password_file" 2>/dev/null)"; then
    private_directory_mode="$(stat -f '%Lp' "$(dirname "$password_file")")"
  else
    password_mode="$(stat -c '%a' "$password_file")"
    private_directory_mode="$(stat -c '%a' "$(dirname "$password_file")")"
  fi
  [[ "$password_mode" == 600 && "$private_directory_mode" == 700 ]]
  printf '%s\n' "$password_file" >>"$BOOTSTRAP_PASSWORD_FILES"
  [[ "${BOOTSTRAP_CREATE_FAIL:-0}" == 0 ]] || exit 1
  if [[ "$*" == *" --dry-run=client "* ]]; then
    printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"fixture"},"type":"Opaque","data":{"password":"fixture"}}\n'
  fi
  exit 0
fi
if [[ "$1" == create && "$2" == "-f" ]]; then cat >/dev/null; exit 0; fi
[[ "$1" == get && "$2" == secret ]] || exit 1
secret="$3"
arguments="$*"
if [[ "${BOOTSTRAP_CREATE_MODE:-}" == postgres && "$secret" == *-postgres-bootstrap ]]; then exit 1; fi
if [[ "${BOOTSTRAP_CREATE_MODE:-}" == kurrent && "$secret" != *-tls ]]; then exit 1; fi
if [[ "$arguments" == *"{.immutable}"* ]]; then printf true; exit 0; fi
if [[ "$arguments" == *"{.type}"* ]]; then
  case "$secret" in
    *-tls) printf kubernetes.io/tls ;;
    *-history-service) printf kubernetes.io/basic-auth ;;
    *-postgres-bootstrap) printf kubernetes.io/basic-auth ;;
    *) printf Opaque ;;
  esac
  exit 0
fi
if [[ "$secret" == *-postgres-bootstrap ]]; then
  if [[ "$arguments" == *"{.data.username}"* ]]; then
    case "$secret" in
      *-opencrane-postgres-bootstrap) printf opencrane ;;
      *-litellm-postgres-bootstrap) printf litellm ;;
      *-admin-postgres-bootstrap) printf opencrane_database_admin ;;
    esac | base64 | tr -d '\n'
  elif [[ "$arguments" == *"{.data.password}"* ]]; then
    printf cGFzc3dvcmQ=
  fi
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

cat >"$TEST_DIRECTORY/bin/openssl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == rand && "$2" == -base64 && "$3" == 36 ]]; then
  printf '%s\n' "$PASSWORD_SENTINEL"
  exit 0
fi
exec "$REAL_OPENSSL" "$@"
MOCK
chmod +x "$TEST_DIRECTORY/bin/openssl"

export PATH="$TEST_DIRECTORY/bin:$PATH"
export KURRENTDB_FIXTURES="$FIXTURES"
export BOOTSTRAP_KUBECTL_CALLS="$TEST_DIRECTORY/kubectl.calls"
export BOOTSTRAP_PASSWORD_FILES="$TEST_DIRECTORY/password.files"
export PASSWORD_SENTINEL REAL_OPENSSL

_assert_password_custody() {
  local expected_count="$1" encoded_password password_file
  encoded_password="$(printf '%s' "$PASSWORD_SENTINEL" | base64 | tr -d '\n')"
  [[ "$(wc -l <"$BOOTSTRAP_PASSWORD_FILES" | tr -d ' ')" == "$expected_count" ]]
  grep -Fq -- '--from-file=password=' "$BOOTSTRAP_KUBECTL_CALLS"
  ! grep -Fq -- '--from-literal=password=' "$BOOTSTRAP_KUBECTL_CALLS"
  ! grep -Fq "$PASSWORD_SENTINEL" "$BOOTSTRAP_KUBECTL_CALLS" "$TEST_DIRECTORY/create.stdout" "$TEST_DIRECTORY/create.stderr"
  ! grep -Fq "$encoded_password" "$BOOTSTRAP_KUBECTL_CALLS" "$TEST_DIRECTORY/create.stdout" "$TEST_DIRECTORY/create.stderr"
  while IFS= read -r password_file; do
    [[ ! -e "$password_file" ]]
  done <"$BOOTSTRAP_PASSWORD_FILES"
  if find "$PRIVATE_TMP" -mindepth 1 -print -quit | grep -q .; then
    echo 'Bootstrap helper retained private password files.' >&2
    exit 1
  fi
}

for create_case in \
  'postgres:--provision-postgres-bootstrap-secrets' \
  'kurrent:--provision-kurrentdb-bootstrap-secrets'; do
  create_mode="${create_case%%:*}"
  create_action="${create_case#*:}"
  : >"$BOOTSTRAP_KUBECTL_CALLS"
  : >"$BOOTSTRAP_PASSWORD_FILES"
  BOOTSTRAP_CREATE_MODE="$create_mode" TMPDIR="$PRIVATE_TMP" \
    bash "$DEPLOY_SCRIPT" "$create_action" \
      --namespace opencrane-testv5 --release opencrane-testv5 \
      >"$TEST_DIRECTORY/create.stdout" 2>"$TEST_DIRECTORY/create.stderr"
  _assert_password_custody 3
done

: >"$BOOTSTRAP_KUBECTL_CALLS"
: >"$BOOTSTRAP_PASSWORD_FILES"
if BOOTSTRAP_CREATE_MODE=postgres BOOTSTRAP_CREATE_FAIL=1 TMPDIR="$PRIVATE_TMP" \
  bash "$DEPLOY_SCRIPT" --provision-postgres-bootstrap-secrets \
    --namespace opencrane-testv5 --release opencrane-testv5 \
    >"$TEST_DIRECTORY/create.stdout" 2>"$TEST_DIRECTORY/create.stderr"; then
  echo 'PostgreSQL bootstrap helper ignored a Secret creation failure.' >&2
  exit 1
fi
_assert_password_custody 1

# Invalid input must stop in the selected helper, before namespace creation or secret reads.
_expect_invalid_arguments() {
  : >"$BOOTSTRAP_KUBECTL_CALLS"
  if bash "$DEPLOY_SCRIPT" "$@" >/dev/null 2>"$TEST_DIRECTORY/arguments.error"; then
    echo "Bootstrap action accepted invalid arguments: $*" >&2
    exit 1
  fi
  if [[ -s "$BOOTSTRAP_KUBECTL_CALLS" ]]; then
    echo "Bootstrap action called Kubernetes with invalid arguments: $*" >&2
    exit 1
  fi
}
for action in --provision-postgres-bootstrap-secrets --provision-kurrentdb-bootstrap-secrets; do
  _expect_invalid_arguments "$action"
  _expect_invalid_arguments "$action" --namespace opencrane-testv5
  _expect_invalid_arguments "$action" --release opencrane-testv5
  _expect_invalid_arguments "$action" --namespace
  _expect_invalid_arguments "$action" --namespace opencrane-testv5 --release
  _expect_invalid_arguments "$action" --namespace '' --release opencrane-testv5
  _expect_invalid_arguments "$action" --namespace opencrane-testv5 --release ''
  _expect_invalid_arguments "$action" --namespace opencrane-testv5 --release opencrane-testv5 --unknown
  bash "$DEPLOY_SCRIPT" "$action" --help >/dev/null
  [[ ! -s "$BOOTSTRAP_KUBECTL_CALLS" ]] || { echo 'Bootstrap help called Kubernetes.' >&2; exit 1; }
done

bash "$DEPLOY_SCRIPT" --provision-postgres-bootstrap-secrets \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null
for authority in opencrane litellm admin; do
  grep -Fq "get secret opencrane-testv5-$authority-postgres-bootstrap -n opencrane-testv5" "$BOOTSTRAP_KUBECTL_CALLS"
done
if grep -Fq 'create secret' "$BOOTSTRAP_KUBECTL_CALLS"; then
  echo 'PostgreSQL bootstrap rerun tried to replace existing credentials.' >&2
  exit 1
fi

bash "$DEPLOY_SCRIPT" --provision-kurrentdb-bootstrap-secrets \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null

openssl genrsa -out "$TEST_DIRECTORY/wrong.key" 2048 >/dev/null 2>&1
base64 <"$TEST_DIRECTORY/wrong.key" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.key"
if bash "$DEPLOY_SCRIPT" --provision-kurrentdb-bootstrap-secrets \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null 2>"$TEST_DIRECTORY/mismatch.error"; then
  echo 'KurrentDB provisioner accepted a mismatched TLS private key.' >&2
  exit 1
fi
grep -Fq 'certificate and private key do not match' "$TEST_DIRECTORY/mismatch.error"

base64 <"$TEST_DIRECTORY/tls.key" | tr -d '\n' >"$FIXTURES/opencrane-testv5-kurrentdb-tls.tls.key"
: >"$FIXTURES/opencrane-testv5-kurrentdb-bootstrap.password"
if bash "$DEPLOY_SCRIPT" --provision-kurrentdb-bootstrap-secrets \
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
if bash "$DEPLOY_SCRIPT" --provision-kurrentdb-bootstrap-secrets \
  --namespace opencrane-testv5 --release opencrane-testv5 >/dev/null 2>"$TEST_DIRECTORY/purpose.error"; then
  echo 'KurrentDB provisioner accepted a client-only certificate for its TLS server.' >&2
  exit 1
fi
grep -Fq 'is not a server certificate signed by its CA' "$TEST_DIRECTORY/purpose.error"
echo 'PostgreSQL and KurrentDB bootstrap Secrets entrypoint contract: PASS'
