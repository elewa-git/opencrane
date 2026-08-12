#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PUBLISHER="$ROOT_DIR/apps/postgres/scripts/publish-initdb-baseline-config-map.sh"
BASELINE="$ROOT_DIR/apps/opencrane/prisma/bootstrap/target-baseline.sql"
REAL_KUBECTL="$(command -v kubectl)"
TEST_DIR="$(mktemp -d)"
CAPTURE_FILE="$TEST_DIR/applied.yaml"
trap 'rm -rf "$TEST_DIR"' EXIT

export REAL_KUBECTL CAPTURE_FILE
mkdir -p "$TEST_DIR/bin"
cat >"$TEST_DIR/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  get)
    if [[ "${FAKE_CREATE_RACE:-0}" == "1" && -f "$FAKE_RACE_MARKER" ]]; then
      case "$*" in
        *baseline-sha256*)
          "$REAL_KUBECTL" patch --local -f "$CAPTURE_FILE" --type=merge -p '{}' -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}'
          ;;
        *"{.immutable}"*)
          printf 'true'
          ;;
        *target-baseline*)
          "$REAL_KUBECTL" patch --local -f "$CAPTURE_FILE" --type=merge -p '{}' -o jsonpath='{.data.target-baseline\.sql}'
          ;;
      esac
    elif [[ "${FAKE_EXISTING_MODE:-absent}" == "absent" ]]; then
      exit 1
    else
      case "$*" in
        *baseline-sha256*)
          printf '%s' "$FAKE_BASELINE_DIGEST"
          ;;
        *"{.immutable}"*)
          if [[ "$FAKE_EXISTING_MODE" == "mutable" ]]; then
            printf 'false'
          else
            printf 'true'
          fi
          ;;
        *target-baseline*)
          if [[ "$FAKE_EXISTING_MODE" == "tampered" ]]; then
            printf 'SELECT 1; -- substituted content'
          else
            cat "$FAKE_EXISTING_SQL_FILE"
          fi
          ;;
      esac
    fi
    ;;
  create)
    if [[ "${2:-}" == "-f" && "${3:-}" != "-" ]]; then
      cp "$3" "$CAPTURE_FILE"
      if [[ "${FAKE_CREATE_RACE:-0}" == "1" ]]; then
        touch "$FAKE_RACE_MARKER"
        exit 1
      fi
    else
      exec "$REAL_KUBECTL" "$@"
    fi
    ;;
  patch)
    exec "$REAL_KUBECTL" "$@"
    ;;
  *)
    echo "unexpected kubectl command: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$TEST_DIR/bin/kubectl"

config_map_name="$(PATH="$TEST_DIR/bin:$PATH" bash "$PUBLISHER" opencrane 'owner"quoted' "$BASELINE")"

[[ "$config_map_name" =~ ^opencrane-database-baseline-[a-f0-9]{16}$ ]]
grep -q '^immutable: true$' "$CAPTURE_FILE"
grep -q 'opencrane.ai/baseline-sha256:' "$CAPTURE_FILE"
expected_sql="$TEST_DIR/expected-target-baseline.sql"
"$REAL_KUBECTL" patch --local -f "$CAPTURE_FILE" --type=merge -p '{}' -o jsonpath='{.data.target-baseline\.sql}' >"$expected_sql"
grep -q 'CREATE SCHEMA "opencrane_bootstrap" AUTHORIZATION CURRENT_USER;' "$expected_sql"
grep -q 'REVOKE ALL ON SCHEMA "opencrane_bootstrap" FROM PUBLIC;' "$expected_sql"
grep -q 'GRANT SELECT ON TABLE "opencrane_bootstrap"."target_baseline" TO "owner""quoted";' "$expected_sql"
grep -Eq 'VALUES \(TRUE, '\''[0-9a-f]{64}'\''\);' "$expected_sql"
grep -q 'SET ROLE "owner""quoted";' "$expected_sql"
grep -q 'OpenCrane target database baseline' "$expected_sql"
if grep -q 'kubectl.kubernetes.io/last-applied-configuration' "$CAPTURE_FILE"; then
  echo "publisher added the client-side apply annotation to the baseline ConfigMap" >&2
  exit 1
fi

baseline_digest="$("$REAL_KUBECTL" patch --local -f "$CAPTURE_FILE" --type=merge -p '{}' -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
export FAKE_BASELINE_DIGEST="$baseline_digest"
export FAKE_EXISTING_SQL_FILE="$expected_sql"

export FAKE_RACE_MARKER="$TEST_DIR/race-created"
FAKE_CREATE_RACE=1 PATH="$TEST_DIR/bin:$PATH" \
  bash "$PUBLISHER" opencrane 'owner"quoted' "$BASELINE" >"$TEST_DIR/race.out"
grep -Eq '^opencrane-database-baseline-[a-f0-9]{16}$' "$TEST_DIR/race.out"

for existing_mode in tampered mutable; do
  if FAKE_EXISTING_MODE="$existing_mode" PATH="$TEST_DIR/bin:$PATH" \
    bash "$PUBLISHER" opencrane 'owner"quoted' "$BASELINE" >"$TEST_DIR/$existing_mode.out" 2>&1; then
    echo "publisher accepted an existing $existing_mode baseline ConfigMap" >&2
    exit 1
  fi
  grep -q 'is not immutable or its SQL bytes do not match' "$TEST_DIR/$existing_mode.out"
done

echo "postgres initdb baseline publisher contract: PASS"
