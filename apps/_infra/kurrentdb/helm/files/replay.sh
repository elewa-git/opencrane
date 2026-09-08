#!/bin/sh
# Replays the installed silo's activation queue from a deployment-owned maintenance Job.
set -eu

endpoint="$(printf '%s' "$OPENCRANE_KURRENTDB_REPLAY_TARGET" | jq -er '.endpoint')"
stream="$(printf '%s' "$OPENCRANE_KURRENTDB_REPLAY_TARGET" | jq -er '.streamName')"
password="$(cat /var/run/opencrane/kurrentdb-bootstrap-admin/password)"
[ -n "$password" ] || { echo 'KurrentDB administrator credential is empty.' >&2; exit 1; }
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 60 --cacert /var/run/opencrane/kurrentdb-tls/ca.crt \
  --user "admin:$password" --request POST \
  "$endpoint/subscriptions/$stream/conversation-computer-activation/replayParked")"
case "$status" in
  200|202|204) echo 'Parked conversation-computer activations were submitted for replay.' ;;
  *) echo "KurrentDB refused activation replay (HTTP $status)." >&2; exit 1 ;;
esac
