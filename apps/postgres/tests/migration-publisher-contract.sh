#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PUBLISHER="$ROOT_DIR/apps/postgres/scripts/publish-database-migration-config-map.sh"
REAL_KUBECTL="$(command -v kubectl)"
TEST_DIR="$(mktemp -d)"
CAPTURE_FILE="$TEST_DIR/config-map.yaml"
SQL_FILE="$TEST_DIR/migration.sql"
trap 'rm -rf "$TEST_DIR"' EXIT
printf '%s\n' 'SELECT 1;' >"$SQL_FILE"
EXPECTED_SHA256="$(shasum -a 256 "$SQL_FILE" | awk '{print $1}')"

export REAL_KUBECTL CAPTURE_FILE SQL_FILE EXPECTED_SHA256
mkdir -p "$TEST_DIR/bin"
cat >"$TEST_DIR/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  get)
    if [[ "${FAKE_CREATE_RACE:-0}" == "1" && -f "$FAKE_RACE_MARKER" ]]; then
      :
    elif [[ "${FAKE_EXISTING:-0}" != "1" ]]; then
      exit 1
    fi
    case "$*" in
      *migration-sql-sha256*) printf '%s' "$EXPECTED_SHA256" ;;
      *'{.immutable}'*) printf 'true' ;;
      *migration*) cat "${FAKE_EXISTING_SQL:-$SQL_FILE}" ;;
    esac
    ;;
  create)
    if [[ "${2:-}" == "-f" ]]; then
      cp "$3" "$CAPTURE_FILE"
      if [[ "${FAKE_CREATE_FAILURE:-0}" == "1" ]]; then exit 1; fi
      if [[ "${FAKE_CREATE_RACE:-0}" == "1" ]]; then
        touch "$FAKE_RACE_MARKER"
        exit 1
      fi
    else
      exec "$REAL_KUBECTL" "$@"
    fi
    ;;
  patch) exec "$REAL_KUBECTL" "$@" ;;
  *) echo "unexpected kubectl: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TEST_DIR/bin/kubectl"

name="$(PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" opencrane 0.7.0-to-0.8.0 "$SQL_FILE" "$EXPECTED_SHA256")"
[[ "$name" =~ ^opencrane-database-migration-0-7-0-to-0-8-0-[0-9a-f]{16}$ ]]
grep -q '^immutable: true$' "$CAPTURE_FILE"
grep -q 'opencrane.ai/migration-id: 0.7.0-to-0.8.0' "$CAPTURE_FILE"
grep -q "opencrane.ai/migration-sql-sha256: $EXPECTED_SHA256" "$CAPTURE_FILE"

FAKE_EXISTING=1 PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" \
  opencrane 0.7.0-to-0.8.0 "$SQL_FILE" "$EXPECTED_SHA256" >/dev/null

export FAKE_RACE_MARKER="$TEST_DIR/race-created"
FAKE_CREATE_RACE=1 PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" \
  opencrane 0.7.0-to-0.8.0 "$SQL_FILE" "$EXPECTED_SHA256" >"$TEST_DIR/race.out"
grep -Eq '^opencrane-database-migration-0-7-0-to-0-8-0-[0-9a-f]{16}$' "$TEST_DIR/race.out"

if FAKE_CREATE_FAILURE=1 PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" \
  opencrane 0.7.0-to-0.8.0 "$SQL_FILE" "$EXPECTED_SHA256" >"$TEST_DIR/outage.out" 2>&1; then
  echo "migration publisher accepted a persistent Kubernetes API failure" >&2
  exit 1
fi
grep -q 'expected immutable migration ConfigMap' "$TEST_DIR/outage.out"

printf '%s\n' 'SELECT 2;' >"$TEST_DIR/tampered.sql"
if FAKE_EXISTING=1 FAKE_EXISTING_SQL="$TEST_DIR/tampered.sql" PATH="$TEST_DIR/bin:$PATH" \
  bash "$PUBLISHER" opencrane 0.7.0-to-0.8.0 "$SQL_FILE" "$EXPECTED_SHA256" >/dev/null 2>&1; then
  echo "migration publisher accepted substituted immutable SQL bytes" >&2
  exit 1
fi
if PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" opencrane 0.7.0-to-0.8.0 \
  "$SQL_FILE" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa >/dev/null 2>&1; then
  echo "migration publisher accepted a wrong manifest SQL digest" >&2
  exit 1
fi

echo "postgres migration publisher contract: PASS"
