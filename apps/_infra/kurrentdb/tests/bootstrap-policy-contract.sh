#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
POLICY="$ROOT_DIR/apps/_infra/kurrentdb/helm/files/bootstrap.sh"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

sh -n "$POLICY"
grep -Fq 'bootstrap_temporary_directory="$(mktemp -d)"' "$POLICY"
grep -Fq 'trap cleanup_bootstrap_files EXIT HUP INT TERM' "$POLICY"
grep -Fq -- '--header "@$admin_authorization_header"' "$POLICY"
grep -Fq -- '--header "@$service_authorization_header"' "$POLICY"
if grep -Fq -- '--user' "$POLICY"; then
  echo "KurrentDB bootstrap exposes a credential through curl arguments" >&2
  exit 1
fi
if grep -Eq '=\$\(mktemp\)$' "$POLICY"; then
  echo "KurrentDB bootstrap still creates untracked temporary files" >&2
  exit 1
fi
if env -i PATH="$PATH" /bin/sh "$POLICY" >"$FIXTURE_DIR/missing.out" 2>&1; then
  echo "KurrentDB bootstrap accepted an implicit deployment contract" >&2
  exit 1
fi
grep -Fq 'KURRENTDB_BOOTSTRAP_ENDPOINT is required' "$FIXTURE_DIR/missing.out"

printf '%s\n' ca > "$FIXTURE_DIR/ca.crt"
printf '%s\n' admin-secret > "$FIXTURE_DIR/admin-password"
printf '%s\n' opencrane-history > "$FIXTURE_DIR/history-username"
printf '%s\n' history-secret > "$FIXTURE_DIR/history-password"
COMMON_ENV=(
  PATH="$PATH"
  KURRENTDB_BOOTSTRAP_CA_FILE="$FIXTURE_DIR/ca.crt"
  KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE="$FIXTURE_DIR/admin-password"
  KURRENTDB_HISTORY_USERNAME_FILE="$FIXTURE_DIR/history-username"
  KURRENTDB_HISTORY_PASSWORD_FILE="$FIXTURE_DIR/history-password"
  KURRENTDB_BOOTSTRAP_SILO_ID=local-development
  KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS=1
  KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS=30
)

if env -i "${COMMON_ENV[@]}" KURRENTDB_BOOTSTRAP_ENDPOINT=http://127.0.0.1:2113 /bin/sh "$POLICY" >"$FIXTURE_DIR/http.out" 2>&1; then
  echo "KurrentDB bootstrap accepted an unencrypted endpoint" >&2
  exit 1
fi
grep -Fq 'requires an HTTPS endpoint' "$FIXTURE_DIR/http.out"

ln -s "$FIXTURE_DIR/ca.crt" "$FIXTURE_DIR/linked-ca.crt"
if env -i "${COMMON_ENV[@]}" \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://127.0.0.1:2113 \
  KURRENTDB_BOOTSTRAP_CA_FILE="$FIXTURE_DIR/linked-ca.crt" \
  /bin/sh "$POLICY" >"$FIXTURE_DIR/link.out" 2>&1; then
  echo "KurrentDB bootstrap accepted a symbolic-link trust root" >&2
  exit 1
fi
grep -Fq 'regular, non-symbolic-link file' "$FIXTURE_DIR/link.out"

mkdir -p "$FIXTURE_DIR/projected/..2026_09_15_10_37"
printf '%s\n' ca > "$FIXTURE_DIR/projected/..2026_09_15_10_37/ca.crt"
ln -s '..2026_09_15_10_37' "$FIXTURE_DIR/projected/..data"
ln -s '..data/ca.crt' "$FIXTURE_DIR/projected/ca.crt"
for secret_input in 'admin admin-password password' 'username history-username username' 'history history-password password'; do
  read -r mount_name source_name projected_name <<< "$secret_input"
  mkdir -p "$FIXTURE_DIR/$mount_name/..2026_09_15_10_37"
  cp "$FIXTURE_DIR/$source_name" "$FIXTURE_DIR/$mount_name/..2026_09_15_10_37/$projected_name"
  ln -s '..2026_09_15_10_37' "$FIXTURE_DIR/$mount_name/..data"
  ln -s "..data/$projected_name" "$FIXTURE_DIR/$mount_name/$projected_name"
done
if env -i "${COMMON_ENV[@]}" \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://127.0.0.1:2113 \
  KURRENTDB_BOOTSTRAP_CA_FILE="$FIXTURE_DIR/projected/ca.crt" \
  /bin/sh "$POLICY" >"$FIXTURE_DIR/projected-without-opt-in.out" 2>&1; then
  echo "KurrentDB bootstrap accepted a projected Secret without chart opt-in" >&2
  exit 1
fi
grep -Fq 'regular, non-symbolic-link file' "$FIXTURE_DIR/projected-without-opt-in.out"

if env -i "${COMMON_ENV[@]}" \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://127.0.0.1:2113 \
  KURRENTDB_BOOTSTRAP_CA_FILE="$FIXTURE_DIR/projected/ca.crt" \
  KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE="$FIXTURE_DIR/admin/password" \
  KURRENTDB_HISTORY_USERNAME_FILE="$FIXTURE_DIR/username/username" \
  KURRENTDB_HISTORY_PASSWORD_FILE="$FIXTURE_DIR/history/password" \
  KURRENTDB_BOOTSTRAP_PROJECTED_SECRETS=kubernetes \
  KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS=1 \
  /bin/sh "$POLICY" >"$FIXTURE_DIR/projected-with-opt-in.out" 2>&1; then
  echo "KurrentDB bootstrap unexpectedly reached an unavailable fixture endpoint" >&2
  exit 1
fi
grep -Fq 'KurrentDB did not become ready before the bootstrap deadline' "$FIXTURE_DIR/projected-with-opt-in.out"

ln -s "$FIXTURE_DIR/ca.crt" "$FIXTURE_DIR/projected/bad-ca.crt"
if env -i "${COMMON_ENV[@]}" \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://127.0.0.1:2113 \
  KURRENTDB_BOOTSTRAP_CA_FILE="$FIXTURE_DIR/projected/bad-ca.crt" \
  KURRENTDB_BOOTSTRAP_PROJECTED_SECRETS=kubernetes \
  /bin/sh "$POLICY" >"$FIXTURE_DIR/unsafe-projection.out" 2>&1; then
  echo "KurrentDB bootstrap accepted an arbitrary symbolic-link trust root" >&2
  exit 1
fi
grep -Fq 'regular, non-symbolic-link file' "$FIXTURE_DIR/unsafe-projection.out"

mkdir -p "$FIXTURE_DIR/mock-bin" "$FIXTURE_DIR/mock-state"
cat > "$FIXTURE_DIR/mock-bin/curl" <<'MOCK_CURL'
#!/bin/sh
set -eu
output_file=""
request_method="GET"
request_body=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output_file="$2"; shift 2 ;;
    --request) request_method="$2"; shift 2 ;;
    --data-binary) request_body="$2"; shift 2 ;;
    --write-out|--cacert|--header) shift 2 ;;
    --silent|--show-error|--fail) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */health/live) exit 0 ;;
  */users/opencrane-history)
    get_attempts_file="$MOCK_STATE_DIR/get-attempts"
    get_attempts=0
    if [ -f "$get_attempts_file" ]; then get_attempts="$(cat "$get_attempts_file")"; fi
    get_attempts=$((get_attempts + 1))
    printf '%s' "$get_attempts" > "$get_attempts_file"
    if [ "${MOCK_ALWAYS_GET_408:-0}" = 1 ] \
      || [ "$get_attempts" -le "${MOCK_GET_408_COUNT:-0}" ]; then
      : > "$output_file"
      printf 408
      exit 0
    fi
    if [ -f "$MOCK_STATE_DIR/user-created" ]; then
      printf '{"loginName":"opencrane-history","groups":[]}' > "$output_file"
      printf 200
    else
      : > "$output_file"
      printf 404
    fi
    ;;
  */users)
    [ -n "$request_body" ] || exit 9
    attempts_file="$MOCK_STATE_DIR/create-attempts"
    attempts=0
    if [ -f "$attempts_file" ]; then attempts="$(cat "$attempts_file")"; fi
    attempts=$((attempts + 1))
    printf '%s' "$attempts" > "$attempts_file"
    if [ "$attempts" -eq 1 ]; then
      if [ "${MOCK_TIMEOUT_CREATES_USER:-0}" = 1 ]; then : > "$MOCK_STATE_DIR/user-created"; fi
      printf 408
    else
      : > "$MOCK_STATE_DIR/user-created"
      printf 201
    fi
    ;;
  */streams/%24settings/head)
    cat > "$output_file" <<'SETTINGS'
{"$userStreamAcl":{"$r":["$admins","opencrane-history"],"$w":["$admins","opencrane-history"],"$d":"$admins","$mr":"$admins","$mw":"$admins"},"$systemStreamAcl":{"$r":"$admins","$w":"$admins","$d":"$admins","$mr":"$admins","$mw":"$admins"}}
SETTINGS
    printf 200
    ;;
  */streams/%24settings) printf 201 ;;
  */subscriptions/*/info) printf 404 ;;
  */subscriptions/*)
    [ "$request_method" = "PUT" ] || exit 9
    printf 201
    ;;
  */streams/opencrane-history-bootstrap-probe) printf 404 ;;
  *) exit 9 ;;
esac
MOCK_CURL
cat > "$FIXTURE_DIR/mock-bin/sleep" <<'MOCK_SLEEP'
#!/bin/sh
exit 0
MOCK_SLEEP
cat > "$FIXTURE_DIR/mock-bin/date" <<'MOCK_DATE'
#!/bin/sh
set -eu
[ "$1" = +%s ] || exit 9
clock_file="$MOCK_STATE_DIR/clock"
clock=100
if [ -f "$clock_file" ]; then clock="$(cat "$clock_file")"; fi
printf '%s\n' "$clock"
printf '%s' "$((clock + 2))" > "$clock_file"
MOCK_DATE
chmod 755 "$FIXTURE_DIR/mock-bin/curl" "$FIXTURE_DIR/mock-bin/date" "$FIXTURE_DIR/mock-bin/sleep"
env -i "${COMMON_ENV[@]}" \
  PATH="$FIXTURE_DIR/mock-bin:$PATH" \
  MOCK_STATE_DIR="$FIXTURE_DIR/mock-state" \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://kurrentdb.example.test:2113 \
  /bin/sh "$POLICY"
[[ "$(cat "$FIXTURE_DIR/mock-state/create-attempts")" == 2 ]]
[[ -f "$FIXTURE_DIR/mock-state/user-created" ]]

mkdir "$FIXTURE_DIR/mock-state-uncertain"
env -i "${COMMON_ENV[@]}" \
  PATH="$FIXTURE_DIR/mock-bin:$PATH" \
  MOCK_STATE_DIR="$FIXTURE_DIR/mock-state-uncertain" \
  MOCK_TIMEOUT_CREATES_USER=1 \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://kurrentdb.example.test:2113 \
  /bin/sh "$POLICY"
[[ "$(cat "$FIXTURE_DIR/mock-state-uncertain/create-attempts")" == 1 ]]
[[ -f "$FIXTURE_DIR/mock-state-uncertain/user-created" ]]

mkdir "$FIXTURE_DIR/mock-state-get-timeout"
env -i "${COMMON_ENV[@]}" \
  PATH="$FIXTURE_DIR/mock-bin:$PATH" \
  MOCK_STATE_DIR="$FIXTURE_DIR/mock-state-get-timeout" \
  MOCK_GET_408_COUNT=1 \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://kurrentdb.example.test:2113 \
  /bin/sh "$POLICY"
[[ "$(cat "$FIXTURE_DIR/mock-state-get-timeout/get-attempts")" == 3 ]]
[[ "$(cat "$FIXTURE_DIR/mock-state-get-timeout/create-attempts")" == 2 ]]

mkdir "$FIXTURE_DIR/mock-state-deadline"
if env -i "${COMMON_ENV[@]}" \
  PATH="$FIXTURE_DIR/mock-bin:$PATH" \
  MOCK_STATE_DIR="$FIXTURE_DIR/mock-state-deadline" \
  MOCK_ALWAYS_GET_408=1 \
  KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS=3 \
  KURRENTDB_BOOTSTRAP_ENDPOINT=https://kurrentdb.example.test:2113 \
  /bin/sh "$POLICY" >"$FIXTURE_DIR/deadline.out" 2>&1; then
  echo "KurrentDB bootstrap ignored its service-user deadline" >&2
  exit 1
fi
grep -Fq 'did not finish HistoryStore service-user bootstrap before the deadline' "$FIXTURE_DIR/deadline.out"
[[ "$(cat "$FIXTURE_DIR/mock-state-deadline/get-attempts")" == 2 ]]

echo "KurrentDB bootstrap policy contract: PASS"
