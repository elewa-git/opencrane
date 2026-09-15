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

echo "KurrentDB bootstrap policy contract: PASS"
