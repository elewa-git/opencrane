#!/bin/sh
# Replays the installed silo's activation queue from a deployment-owned maintenance Job.
set -eu

endpoint="$(printf '%s' "$OPENCRANE_KURRENTDB_REPLAY_TARGET" | jq -er '.endpoint')"
stream="$(printf '%s' "$OPENCRANE_KURRENTDB_REPLAY_TARGET" | jq -er '.streamName')"
deadline="$(( $(date +%s) + ${OPENCRANE_KURRENTDB_REPLAY_TIMEOUT_SECONDS:?The replay Job requires its timeout budget} ))"

# Database readiness outside this Pod does not establish this Pod's service path.
# Retry read-only health checks before sending the replay POST, which must not be retried.
while :; do
  remaining="$((deadline - $(date +%s)))"
  [ "$remaining" -gt 0 ] || { echo 'KurrentDB readiness exceeded the replay Job timeout.' >&2; exit 1; }
  request_timeout="$remaining"
  [ "$request_timeout" -le 5 ] || request_timeout=5
  if health_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout "$request_timeout" --max-time "$request_timeout" \
    --cacert /var/run/opencrane/kurrentdb-tls/ca.crt "$endpoint/health/live")"; then
    health_exit=0
  else
    health_exit=$?
  fi
  case "$health_exit:$health_status" in
    0:200|0:204) break ;;
    6:*|7:*|28:*|0:503) ;;
    *) echo "KurrentDB readiness failed (curl $health_exit, HTTP $health_status)." >&2; exit 1 ;;
  esac
  remaining="$((deadline - $(date +%s)))"
  [ "$remaining" -gt 0 ] || { echo 'KurrentDB readiness exceeded the replay Job timeout.' >&2; exit 1; }
  [ "$remaining" -le 2 ] || remaining=2
  sleep "$remaining"
done

remaining="$((deadline - $(date +%s)))"
[ "$remaining" -gt 0 ] || { echo 'The replay Job timeout elapsed before replay.' >&2; exit 1; }
[ "$remaining" -le 60 ] || remaining=60
password="$(cat /var/run/opencrane/kurrentdb-bootstrap-admin/password)"
[ -n "$password" ] || { echo 'KurrentDB administrator credential is empty.' >&2; exit 1; }
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time "$remaining" --cacert /var/run/opencrane/kurrentdb-tls/ca.crt \
  --user "admin:$password" --request POST \
  "$endpoint/subscriptions/$stream/conversation-computer-activation/replayParked")"
case "$status" in
  200|202|204) echo 'Parked conversation-computer activations were submitted for replay.' ;;
  *) echo "KurrentDB refused activation replay (HTTP $status)." >&2; exit 1 ;;
esac
