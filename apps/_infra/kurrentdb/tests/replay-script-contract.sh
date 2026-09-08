#!/usr/bin/env bash
# Verifies the maintenance script's HTTP contract and secret-free failure output.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../helm/files" && pwd)/replay.sh"
DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$DIRECTORY"' EXIT
mkdir "$DIRECTORY/bin"
export REPLAY_CALLS="$DIRECTORY"
cat >"$DIRECTORY/bin/cat" <<'SH'
#!/bin/sh
[ "$1" = /var/run/opencrane/kurrentdb-bootstrap-admin/password ] || exit 9
printf fixture-password
SH
cat >"$DIRECTORY/bin/curl" <<'SH'
#!/bin/sh
for argument in "$@"; do url="$argument"; done
case "$url" in
  */health/live)
    printf 'health\n' >>"$REPLAY_CALLS/calls"
    printf '%s\n' "$@" >"$REPLAY_CALLS/health-arguments"
    count=0
    [ ! -f "$REPLAY_CALLS/health-count" ] || read -r count <"$REPLAY_CALLS/health-count"
    count=$((count + 1))
    printf '%s\n' "$count" >"$REPLAY_CALLS/health-count"
    if [ "$count" -le "${HEALTH_FAILURES:-0}" ]; then
      printf '%s' "${HEALTH_STATUS:-000}"
      exit "${HEALTH_EXIT:-7}"
    fi
    printf 204
    exit 0
    ;;
esac
printf 'post\n' >>"$REPLAY_CALLS/calls"
printf '%s\n' "$@" >"$REPLAY_CALLS/post-arguments"
printf '%s' "$REPLAY_STATUS"
exit "${REPLAY_EXIT:-0}"
SH
cat >"$DIRECTORY/bin/date" <<'SH'
#!/bin/sh
[ "$1" = +%s ] || exit 9
read -r now <"$REPLAY_CALLS/clock"
printf '%s\n' "$now"
SH
cat >"$DIRECTORY/bin/sleep" <<'SH'
#!/bin/sh
read -r now <"$REPLAY_CALLS/clock"
printf '%s\n' "$((now + $1))" >"$REPLAY_CALLS/clock"
printf '%s\n' "$1" >>"$REPLAY_CALLS/sleeps"
SH
chmod +x "$DIRECTORY/bin/"*
target='{"endpoint":"https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113","streamName":"computer-activations-testv5"}'
run_script()
{
  rm -f "$DIRECTORY/calls" "$DIRECTORY/health-count" "$DIRECTORY/sleeps" "$DIRECTORY/post-arguments"
  printf '100\n' >"$DIRECTORY/clock"
  PATH="$DIRECTORY/bin:$PATH" OPENCRANE_KURRENTDB_REPLAY_TARGET="$target" \
    OPENCRANE_KURRENTDB_REPLAY_TIMEOUT_SECONDS=3 sh "$SCRIPT" >>"$DIRECTORY/output" 2>&1
}
for status in 200 202 204; do
  REPLAY_STATUS="$status" run_script
  [[ "$(cat "$DIRECTORY/calls")" == $'health\npost' ]] || { echo 'Replay skipped its in-Pod readiness check.' >&2; exit 1; }
done
for status in 301 401 403 404 500; do
  if REPLAY_STATUS="$status" run_script; then
    echo "Replay accepted HTTP $status." >&2; exit 1
  fi
  [[ "$(cat "$DIRECTORY/calls")" == $'health\npost' ]] || { echo 'Replay retried a refused POST.' >&2; exit 1; }
done
for code in 7 28 60; do
  if REPLAY_STATUS=000 REPLAY_EXIT="$code" run_script; then
    echo 'Replay ignored a POST transport failure.' >&2; exit 1
  fi
  [[ "$(cat "$DIRECTORY/calls")" == $'health\npost' ]] || { echo 'Replay retried an uncertain POST.' >&2; exit 1; }
done
HEALTH_FAILURES=1 REPLAY_STATUS=200 run_script
[[ "$(cat "$DIRECTORY/calls")" == $'health\nhealth\npost' ]] || { echo 'Replay did not recover from its first refused connection.' >&2; exit 1; }
for kind in health post; do
  grep -Fxq -- '--cacert' "$DIRECTORY/$kind-arguments"
  grep -Fxq -- '/var/run/opencrane/kurrentdb-tls/ca.crt' "$DIRECTORY/$kind-arguments"
  grep -Fxq -- '--connect-timeout' "$DIRECTORY/$kind-arguments"
  grep -Fxq -- '--max-time' "$DIRECTORY/$kind-arguments"
  grep -Fxq -- '1' "$DIRECTORY/$kind-arguments"
done
grep -Fxq -- 'POST' "$DIRECTORY/post-arguments"
grep -Fxq -- 'admin:fixture-password' "$DIRECTORY/post-arguments"
grep -Fxq -- 'https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113/subscriptions/computer-activations-testv5/conversation-computer-activation/replayParked' "$DIRECTORY/post-arguments"
if grep -Fq fixture-password "$DIRECTORY/health-arguments"; then echo 'Readiness sent an administrator credential.' >&2; exit 1; fi
HEALTH_FAILURES=1 HEALTH_EXIT=0 HEALTH_STATUS=503 REPLAY_STATUS=200 run_script
[[ "$(cat "$DIRECTORY/calls")" == $'health\nhealth\npost' ]] || { echo 'Replay did not wait for database readiness.' >&2; exit 1; }
for code in 6 7 28; do
  if HEALTH_FAILURES=10 HEALTH_EXIT="$code" REPLAY_STATUS=200 run_script; then
    echo 'Replay accepted an unreachable database.' >&2; exit 1
  fi
  [[ "$(cat "$DIRECTORY/calls")" == $'health\nhealth' && "$(cat "$DIRECTORY/sleeps")" == $'2\n1' && ! -f "$DIRECTORY/post-arguments" ]] || { echo 'Readiness exceeded its budget or attempted replay.' >&2; exit 1; }
done
for failure in '0 401' '0 403' '60 000'; do
  read -r code status <<<"$failure"
  if HEALTH_FAILURES=10 HEALTH_EXIT="$code" HEALTH_STATUS="$status" REPLAY_STATUS=200 run_script; then
    echo 'Replay accepted a permanent readiness failure.' >&2; exit 1
  fi
  [[ "$(cat "$DIRECTORY/calls")" == health && ! -f "$DIRECTORY/sleeps" && ! -f "$DIRECTORY/post-arguments" ]] || { echo 'Readiness retried a permanent failure.' >&2; exit 1; }
done
if grep -Fq fixture-password "$DIRECTORY/output"; then echo 'Replay logged a credential.' >&2; exit 1; fi
echo 'KurrentDB operator replay HTTP contract: PASS'
