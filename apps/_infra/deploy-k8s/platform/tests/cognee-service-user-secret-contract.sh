#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/provision-cognee-service-user-secret.sh"
TEST_DIRECTORY="$(mktemp -d)"
MOCK_BIN="$TEST_DIRECTORY/bin"
MOCK_STATE="$TEST_DIRECTORY/state"
PRIVATE_TMP="$TEST_DIRECTORY/private"
mkdir -p "$MOCK_BIN" "$MOCK_STATE" "$PRIVATE_TMP"
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

CONTEXT="fixture-context"
NAMESPACE="opencrane-fixture"
SECRET_NAME="opencrane-fixture-cognee-service-user"
EMAIL="memory-gateway@fixture.opencrane.invalid"
PASSWORD_SENTINEL="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
COMMON_ARGS=(
  --context "$CONTEXT"
  --namespace "$NAMESPACE"
  --secret "$SECRET_NAME"
  --email "$EMAIL"
  --yes
)

cat >"$MOCK_BIN/openssl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$PASSWORD_SENTINEL"
printf 'openssl %s\n' "$*" >>"$MOCK_STATE/calls"
MOCK

cat >"$MOCK_BIN/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'kubectl %s\n' "$*" >>"$MOCK_STATE/calls"

if [[ "$*" == "config current-context" ]]; then
  [[ "${MOCK_CONTEXT_READ_FAIL:-0}" == "0" ]] || exit 1
  printf '%s\n' "${MOCK_CURRENT_CONTEXT:-$CONTEXT}"
  exit 0
fi

if [[ "$*" == *" get namespace $NAMESPACE "* ]]; then
  [[ "${MOCK_NAMESPACE_READ_FAIL:-0}" == "0" ]] || exit 1
  [[ "${MOCK_NAMESPACE_ABSENT:-0}" == "0" ]] || exit 0
  count_file="$MOCK_STATE/namespace-read-count"
  count=0
  [[ ! -f "$count_file" ]] || count="$(<"$count_file")"
  count=$((count + 1))
  printf '%s' "$count" >"$count_file"
  uid="namespace-uid"
  if [[ "${MOCK_NAMESPACE_REPLACED:-0}" == "1" && "$count" -gt 1 ]]; then uid="replacement-uid"; fi
  jq -n \
    --arg namespace "$NAMESPACE" \
    --arg label "${MOCK_NAMESPACE_LABEL:-$NAMESPACE}" \
    --arg uid "$uid" \
    --arg owner "${MOCK_RETIREMENT_OWNER:-}" \
    '{apiVersion:"v1",kind:"Namespace",metadata:{name:$namespace,uid:$uid,labels:{"kubernetes.io/metadata.name":$label}}}
      | if $owner == "" then . else .metadata.labels["opencrane.ai/retirement-owner"] = $owner end'
  exit 0
fi

if [[ "$*" == *" get secret $SECRET_NAME "* ]]; then
  [[ "${MOCK_SECRET_READ_FAIL:-0}" == "0" ]] || exit 1
  [[ ! -f "$MOCK_STATE/secret.json" ]] || cat "$MOCK_STATE/secret.json"
  exit 0
fi

if [[ "$*" == *" create secret generic $SECRET_NAME "* && "$*" == *" --dry-run=client "* ]]; then
  email_file=""
  password_file=""
  for argument in "$@"; do
    case "$argument" in
      --from-file=email=*) email_file="${argument#--from-file=email=}" ;;
      --from-file=password=*) password_file="${argument#--from-file=password=}" ;;
    esac
  done
  [[ -n "$email_file" && -n "$password_file" ]]
  jq -n \
    --arg namespace "$NAMESPACE" \
    --arg secret "$SECRET_NAME" \
    --arg email "$(base64 <"$email_file" | tr -d '\n')" \
    --arg password "$(base64 <"$password_file" | tr -d '\n')" \
    '{apiVersion:"v1",kind:"Secret",metadata:{namespace:$namespace,name:$secret},type:"Opaque",data:{email:$email,password:$password}}'
  exit 0
fi

if [[ "$*" == *" create --filename=-"* ]]; then
  cat >"$MOCK_STATE/create-input.json"
  [[ "${MOCK_CREATE_RACE:-0}" == "0" ]] || exit 1
  jq '.metadata.uid = "secret-created-uid"' "$MOCK_STATE/create-input.json" >"$MOCK_STATE/secret.json"
  exit 0
fi

printf 'unexpected kubectl call: %s\n' "$*" >&2
exit 97
MOCK
chmod +x "$MOCK_BIN/kubectl" "$MOCK_BIN/openssl"

reset_state()
{
  rm -f "$MOCK_STATE"/* "$PRIVATE_TMP"/* 2>/dev/null || true
}

run_helper()
{
  PATH="$MOCK_BIN:$PATH" \
    TMPDIR="$PRIVATE_TMP" \
    CONTEXT="$CONTEXT" \
    NAMESPACE="$NAMESPACE" \
    SECRET_NAME="$SECRET_NAME" \
    EMAIL="$EMAIL" \
    PASSWORD_SENTINEL="$PASSWORD_SENTINEL" \
    MOCK_STATE="$MOCK_STATE" \
    bash "$SCRIPT" "$@"
}

assert_failure()
{
  local expected="$1"
  shift
  if "$@" >"$TEST_DIRECTORY/stdout" 2>"$TEST_DIRECTORY/stderr"; then
    echo "expected failure containing: $expected" >&2
    exit 1
  fi
  grep -Fq -- "$expected" "$TEST_DIRECTORY/stderr"
}

assert_private_cleanup()
{
  if find "$PRIVATE_TMP" -mindepth 1 -print -quit | grep -q .; then
    echo "private credential files were not cleaned up" >&2
    exit 1
  fi
}

assert_redacted()
{
  local encoded_password
  encoded_password="$(printf '%s' "$PASSWORD_SENTINEL" | base64 | tr -d '\n')"
  ! grep -Fq "$PASSWORD_SENTINEL" "$TEST_DIRECTORY/stdout" "$TEST_DIRECTORY/stderr" "$MOCK_STATE/calls"
  ! grep -Fq "$encoded_password" "$TEST_DIRECTORY/stdout" "$TEST_DIRECTORY/stderr" "$MOCK_STATE/calls"
}

write_valid_secret()
{
  jq -n \
    --arg namespace "$NAMESPACE" \
    --arg secret "$SECRET_NAME" \
    --arg email "$EMAIL" \
    --arg encoded_email "$(printf '%s' "$EMAIL" | base64 | tr -d '\n')" \
    '{apiVersion:"v1",kind:"Secret",metadata:{
        namespace:$namespace,
        name:$secret,
        uid:"secret-existing-uid",
        labels:{
          "app.kubernetes.io/managed-by":"opencrane-deploy-bootstrap",
          "app.kubernetes.io/part-of":"opencrane",
          "app.kubernetes.io/instance":$namespace,
          "app.kubernetes.io/component":"cognee-service-user"
        },
        annotations:{"opencrane.ai/credential-email":$email}
      },immutable:true,type:"Opaque",data:{email:$encoded_email,password:"cHJlc2VydmUtbWU="}}' \
    >"$MOCK_STATE/secret.json"
}

reset_state
assert_failure "--yes is required" run_helper \
  --context "$CONTEXT" --namespace "$NAMESPACE" --secret "$SECRET_NAME" --email "$EMAIL"
assert_private_cleanup

reset_state
assert_failure "--context may be supplied only once" run_helper "${COMMON_ARGS[@]}" --context duplicate
assert_private_cleanup

reset_state
assert_failure "unknown argument: --rotate" run_helper "${COMMON_ARGS[@]}" --rotate
assert_private_cleanup

reset_state
assert_failure "--namespace must be an opencrane-* DNS label" run_helper \
  --context "$CONTEXT" --namespace default --secret default-cognee-service-user --email "$EMAIL" --yes
assert_private_cleanup

reset_state
assert_failure "--secret must be <namespace>-cognee-service-user" run_helper \
  --context "$CONTEXT" --namespace "$NAMESPACE" --secret foreign --email "$EMAIL" --yes
assert_private_cleanup

reset_state
assert_failure "--email is malformed" run_helper \
  --context "$CONTEXT" --namespace "$NAMESPACE" --secret "$SECRET_NAME" --email malformed --yes
assert_private_cleanup

reset_state
MOCK_CURRENT_CONTEXT=other assert_failure "expected '$CONTEXT'" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
MOCK_NAMESPACE_READ_FAIL=1 assert_failure "absence was not proven" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
MOCK_NAMESPACE_ABSENT=1 assert_failure "create it through the silo bootstrap first" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
MOCK_NAMESPACE_LABEL=foreign assert_failure "exact Kubernetes identity metadata" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
MOCK_RETIREMENT_OWNER=opencrane-foreign assert_failure "conflicting OpenCrane ownership" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
MOCK_SECRET_READ_FAIL=1 assert_failure "absence was not proven" run_helper "${COMMON_ARGS[@]}"
assert_private_cleanup

reset_state
run_helper "${COMMON_ARGS[@]}" >"$TEST_DIRECTORY/stdout" 2>"$TEST_DIRECTORY/stderr"
jq -e \
  --arg namespace "$NAMESPACE" \
  --arg secret "$SECRET_NAME" \
  --arg email "$EMAIL" \
  '(.metadata.namespace == $namespace)
    and (.metadata.name == $secret)
    and (.metadata.uid == "secret-created-uid")
    and (.metadata.labels["app.kubernetes.io/managed-by"] == "opencrane-deploy-bootstrap")
    and (.metadata.labels["app.kubernetes.io/part-of"] == "opencrane")
    and (.metadata.labels["app.kubernetes.io/instance"] == $namespace)
    and (.metadata.labels["app.kubernetes.io/component"] == "cognee-service-user")
    and (.metadata.annotations["opencrane.ai/credential-email"] == $email)
    and (.immutable == true)
    and (.type == "Opaque")
    and ((.data | keys | sort) == ["email", "password"])' \
  "$MOCK_STATE/secret.json" >/dev/null
grep -Fq 'uid=secret-created-uid' "$TEST_DIRECTORY/stdout"
assert_redacted
assert_private_cleanup

reset_state
write_valid_secret
run_helper "${COMMON_ARGS[@]}" >"$TEST_DIRECTORY/stdout" 2>"$TEST_DIRECTORY/stderr"
grep -Fq 'uid=secret-existing-uid' "$TEST_DIRECTORY/stdout"
! grep -Fq 'openssl ' "$MOCK_STATE/calls"
! grep -Fq ' create secret generic ' "$MOCK_STATE/calls"
assert_redacted
assert_private_cleanup

for mutation in \
  '.metadata.labels["app.kubernetes.io/managed-by"] = "foreign"' \
  '.metadata.labels["app.kubernetes.io/instance"] = "opencrane-foreign"' \
  '.metadata.ownerReferences = [{apiVersion:"v1",kind:"ConfigMap",name:"foreign",uid:"owner-uid"}]' \
  '.immutable = false' \
  '.type = "kubernetes.io/basic-auth"' \
  '.data.extra = "dW5leHBlY3RlZA=="' \
  'del(.data.password)' \
  '.data.password = "***"' \
  '.data.email = "Zm9yZWlnbkBleGFtcGxlLmNvbQ=="'; do
  reset_state
  write_valid_secret
  jq "$mutation" "$MOCK_STATE/secret.json" >"$MOCK_STATE/mutated.json"
  mv "$MOCK_STATE/mutated.json" "$MOCK_STATE/secret.json"
  assert_failure "does not match its immutable OpenCrane ownership and key contract" run_helper "${COMMON_ARGS[@]}"
  ! grep -Fq 'openssl ' "$MOCK_STATE/calls"
  ! grep -Fq ' create secret generic ' "$MOCK_STATE/calls"
  assert_private_cleanup
done

reset_state
MOCK_NAMESPACE_REPLACED=1 assert_failure "namespace '$NAMESPACE' was replaced" run_helper "${COMMON_ARGS[@]}"
! grep -Fq ' create --filename=-' "$MOCK_STATE/calls"
assert_private_cleanup

reset_state
MOCK_CREATE_RACE=1 assert_failure "may have appeared concurrently" run_helper "${COMMON_ARGS[@]}"
assert_redacted
assert_private_cleanup

echo "cognee service-user Secret contract passed"
