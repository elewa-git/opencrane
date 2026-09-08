#!/usr/bin/env bash
# Verifies the maintenance script's HTTP contract and secret-free failure output.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../helm/files" && pwd)/replay.sh"
DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$DIRECTORY"' EXIT
mkdir "$DIRECTORY/bin"
export REPLAY_CALLS="$DIRECTORY/curl-arguments"
cat >"$DIRECTORY/bin/cat" <<'SH'
#!/bin/sh
[ "$1" = /var/run/opencrane/kurrentdb-bootstrap-admin/password ] || exit 9
printf fixture-password
SH
cat >"$DIRECTORY/bin/curl" <<'SH'
#!/bin/sh
printf '%s\n' "$@" >"$REPLAY_CALLS"
printf '%s' "$REPLAY_STATUS"
exit "${REPLAY_EXIT:-0}"
SH
chmod +x "$DIRECTORY/bin/cat" "$DIRECTORY/bin/curl"
target='{"endpoint":"https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113","streamName":"computer-activations-testv5"}'
for status in 200 202 204; do
  PATH="$DIRECTORY/bin:$PATH" OPENCRANE_KURRENTDB_REPLAY_TARGET="$target" REPLAY_STATUS="$status" sh "$SCRIPT" >>"$DIRECTORY/output"
done
for status in 301 401 403 404 500; do
  if PATH="$DIRECTORY/bin:$PATH" OPENCRANE_KURRENTDB_REPLAY_TARGET="$target" REPLAY_STATUS="$status" sh "$SCRIPT" >>"$DIRECTORY/output" 2>&1; then
    echo "Replay accepted HTTP $status." >&2; exit 1
  fi
done
if PATH="$DIRECTORY/bin:$PATH" OPENCRANE_KURRENTDB_REPLAY_TARGET="$target" REPLAY_STATUS=000 REPLAY_EXIT=7 sh "$SCRIPT" >>"$DIRECTORY/output" 2>&1; then
  echo 'Replay ignored a transport failure.' >&2; exit 1
fi
grep -Fxq -- '--cacert' "$REPLAY_CALLS"
grep -Fxq -- '/var/run/opencrane/kurrentdb-tls/ca.crt' "$REPLAY_CALLS"
grep -Fxq -- '--connect-timeout' "$REPLAY_CALLS"
grep -Fxq -- '--max-time' "$REPLAY_CALLS"
grep -Fxq -- '60' "$REPLAY_CALLS"
grep -Fxq -- 'POST' "$REPLAY_CALLS"
grep -Fxq -- 'admin:fixture-password' "$REPLAY_CALLS"
grep -Fxq -- 'https://opencrane-testv5-kurrentdb.opencrane-testv5.svc:2113/subscriptions/computer-activations-testv5/conversation-computer-activation/replayParked' "$REPLAY_CALLS"
if grep -Fq fixture-password "$DIRECTORY/output"; then echo 'Replay logged a credential.' >&2; exit 1; fi
echo 'KurrentDB operator replay HTTP contract: PASS'
