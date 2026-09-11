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

echo "KurrentDB bootstrap policy contract: PASS"
