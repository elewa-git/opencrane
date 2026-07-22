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
    if [[ "${FAKE_EXISTING_MODE:-absent}" == "absent" ]]; then
      exit 1
    fi
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
    ;;
  create|patch)
    exec "$REAL_KUBECTL" "$@"
    ;;
  apply)
    cat >"$CAPTURE_FILE"
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
grep -q 'SET ROLE "owner""quoted";' "$CAPTURE_FILE"
grep -q 'OpenCrane target database baseline' "$CAPTURE_FILE"

expected_sql="$TEST_DIR/expected-target-baseline.sql"
printf 'SET ROLE "%s";\n\n' 'owner""quoted' >"$expected_sql"
cat "$BASELINE" >>"$expected_sql"
if command -v sha256sum >/dev/null 2>&1; then
  baseline_digest="$(sha256sum "$expected_sql" | awk '{print $1}')"
else
  baseline_digest="$(shasum -a 256 "$expected_sql" | awk '{print $1}')"
fi
export FAKE_BASELINE_DIGEST="$baseline_digest"
export FAKE_EXISTING_SQL_FILE="$expected_sql"

for existing_mode in tampered mutable; do
  if FAKE_EXISTING_MODE="$existing_mode" PATH="$TEST_DIR/bin:$PATH" \
    bash "$PUBLISHER" opencrane 'owner"quoted' "$BASELINE" >"$TEST_DIR/$existing_mode.out" 2>&1; then
    echo "publisher accepted an existing $existing_mode baseline ConfigMap" >&2
    exit 1
  fi
  grep -q 'is not immutable or its SQL bytes do not match' "$TEST_DIR/$existing_mode.out"
done

echo "postgres initdb baseline publisher contract: PASS"
