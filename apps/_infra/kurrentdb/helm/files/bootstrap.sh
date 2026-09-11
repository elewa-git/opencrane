#!/bin/sh
set -eu
umask 077

# The same policy runs in the Helm bootstrap Job and in an app-owned local session.
# Every deployment coordinate stays explicit so callers cannot silently weaken TLS.
: "${KURRENTDB_BOOTSTRAP_ENDPOINT:?KURRENTDB_BOOTSTRAP_ENDPOINT is required}"
: "${KURRENTDB_BOOTSTRAP_CA_FILE:?KURRENTDB_BOOTSTRAP_CA_FILE is required}"
: "${KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE:?KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE is required}"
: "${KURRENTDB_HISTORY_USERNAME_FILE:?KURRENTDB_HISTORY_USERNAME_FILE is required}"
: "${KURRENTDB_HISTORY_PASSWORD_FILE:?KURRENTDB_HISTORY_PASSWORD_FILE is required}"
: "${KURRENTDB_BOOTSTRAP_SILO_ID:?KURRENTDB_BOOTSTRAP_SILO_ID is required}"
: "${KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS:?KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS is required}"
: "${KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS:?KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS is required}"

case "$KURRENTDB_BOOTSTRAP_ENDPOINT" in
  https://*) ;;
  *)
    echo "KurrentDB bootstrap requires an HTTPS endpoint." >&2
    exit 1
    ;;
esac
case "$KURRENTDB_BOOTSTRAP_ENDPOINT" in
  *\?*|*\#*|*@*)
    echo "KurrentDB bootstrap endpoint must not contain credentials, a query, or a fragment." >&2
    exit 1
    ;;
esac
case "$KURRENTDB_BOOTSTRAP_SILO_ID" in
  ""|*[!a-z0-9-]*|-*|*-)
    echo "KurrentDB bootstrap silo must be a lowercase DNS label." >&2
    exit 1
    ;;
esac
case "$KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS" in
  ""|*[!0-9]*|0)
    echo "KurrentDB bootstrap subscriber count must be a positive integer." >&2
    exit 1
    ;;
esac
case "$KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS" in
  ""|*[!0-9]*|0)
    echo "KurrentDB bootstrap timeout must be a positive integer." >&2
    exit 1
    ;;
esac

for credential_path in \
  "$KURRENTDB_BOOTSTRAP_CA_FILE" \
  "$KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE" \
  "$KURRENTDB_HISTORY_USERNAME_FILE" \
  "$KURRENTDB_HISTORY_PASSWORD_FILE"
do
  if [ ! -f "$credential_path" ] || [ -L "$credential_path" ]; then
    echo "KurrentDB bootstrap input must be a regular, non-symbolic-link file: $credential_path" >&2
    exit 1
  fi
done

endpoint="${KURRENTDB_BOOTSTRAP_ENDPOINT%/}"
ca_file="$KURRENTDB_BOOTSTRAP_CA_FILE"
admin_password="$(cat "$KURRENTDB_BOOTSTRAP_ADMIN_PASSWORD_FILE")"
history_username="$(cat "$KURRENTDB_HISTORY_USERNAME_FILE")"
history_password="$(cat "$KURRENTDB_HISTORY_PASSWORD_FILE")"

if [ "$history_username" != "opencrane-history" ] || [ -z "$admin_password" ] || [ -z "$history_password" ]; then
  echo "KurrentDB bootstrap credentials must contain the fixed non-empty service identity." >&2
  exit 1
fi

bootstrap_temporary_directory="$(mktemp -d)"
cleanup_bootstrap_files() {
  rm -rf "$bootstrap_temporary_directory"
}
trap cleanup_bootstrap_files EXIT HUP INT TERM

admin_authorization_header="$bootstrap_temporary_directory/admin-authorization.header"
service_authorization_header="$bootstrap_temporary_directory/service-authorization.header"
{
  printf 'Authorization: Basic '
  printf '%s' "admin:$admin_password" | base64 | tr -d '\n'
  printf '\n'
} > "$admin_authorization_header"
{
  printf 'Authorization: Basic '
  printf '%s' "$history_username:$history_password" | base64 | tr -d '\n'
  printf '\n'
} > "$service_authorization_header"

wait_deadline="$(( $(date +%s) + KURRENTDB_BOOTSTRAP_TIMEOUT_SECONDS ))"
until curl --silent --show-error --fail --cacert "$ca_file" --header "@$admin_authorization_header" "$endpoint/health/live" >/dev/null; do
  if [ "$(date +%s)" -ge "$wait_deadline" ]; then
    echo "KurrentDB did not become ready before the bootstrap deadline." >&2
    exit 1
  fi
  sleep 2
done

user_body="$bootstrap_temporary_directory/user.json"
user_status="$(curl --silent --show-error --output "$user_body" --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" "$endpoint/users/opencrane-history")"
case "$user_status" in
  200)
    normalized_user="$(tr -d '[:space:]' < "$user_body")"
    if ! printf '%s' "$normalized_user" | grep -Eq '"([Ll]ogin[Nn]ame|[Uu]sername)":"opencrane-history"' || ! printf '%s' "$normalized_user" | grep -Eq '"([Gg]roups)":\[\]'; then
      echo "The existing KurrentDB service user is not the expected unprivileged identity." >&2
      exit 1
    fi
    ;;
  404)
    create_body="$bootstrap_temporary_directory/create-user.json"
    jq -n --arg password "$history_password" '{LoginName: "opencrane-history", FullName: "OpenCrane HistoryStore", Groups: [], Password: $password}' > "$create_body"
    create_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" --header 'Content-Type: application/json' --data-binary "@$create_body" "$endpoint/users")"
    if [ "$create_status" != "201" ] && [ "$create_status" != "200" ]; then
      echo "KurrentDB refused creation of the HistoryStore service user (HTTP $create_status)." >&2
      exit 1
    fi
    ;;
  *)
    echo "KurrentDB did not return an expected service-user status (HTTP $user_status)." >&2
    exit 1
    ;;
esac

# The first write is idempotent; the read below always proves the current effective ACL.
settings_body="$bootstrap_temporary_directory/settings.json"
cat > "$settings_body" <<'JSON'
[
  {
    "eventId": "1253ddcb-3c10-4a1c-80bf-b16d1a5b8fcb",
    "eventType": "opencrane-history-default-acl",
    "data": {
      "$userStreamAcl": {
        "$r": ["$admins", "opencrane-history"],
        "$w": ["$admins", "opencrane-history"],
        "$d": "$admins",
        "$mr": "$admins",
        "$mw": "$admins"
      },
      "$systemStreamAcl": {
        "$r": "$admins",
        "$w": "$admins",
        "$d": "$admins",
        "$mr": "$admins",
        "$mw": "$admins"
      }
    }
  }
]
JSON
settings_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" --header 'Content-Type: application/vnd.kurrent.events+json' --header 'Kurrent-ExpectedVersion: -1' --data-binary "@$settings_body" "$endpoint/streams/%24settings")"
if [ "$settings_status" != "201" ] && [ "$settings_status" != "200" ] && [ "$settings_status" != "400" ]; then
  echo "KurrentDB refused the HistoryStore default ACL write (HTTP $settings_status)." >&2
  exit 1
fi

existing_settings="$bootstrap_temporary_directory/existing-settings.json"
existing_settings_status="$(curl --silent --show-error --output "$existing_settings" --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" --header 'Accept: application/json' "$endpoint/streams/%24settings/head")"
if [ "$existing_settings_status" != "200" ] || ! jq -e '
  .["$userStreamAcl"] == {
      "$r": ["$admins", "opencrane-history"],
      "$w": ["$admins", "opencrane-history"],
      "$d": "$admins",
      "$mr": "$admins",
      "$mw": "$admins"
    } and .["$systemStreamAcl"] == {
      "$r": "$admins",
      "$w": "$admins",
      "$d": "$admins",
      "$mr": "$admins",
      "$mw": "$admins"
    }
' "$existing_settings" >/dev/null; then
  echo "The existing KurrentDB default ACL is not exactly the HistoryStore ACL." >&2
  exit 1
fi

# The administrator creates the durable activation queue once. The HistoryStore identity can
# consume it through the ordinary stream ACL but never receives subscription administration.
activation_stream="computer-activations-$KURRENTDB_BOOTSTRAP_SILO_ID"
activation_group="conversation-computer-activation"
subscription_url="$endpoint/subscriptions/$activation_stream/$activation_group"
subscription_body="$bootstrap_temporary_directory/subscription.json"
subscription_status="$(curl --silent --show-error --output "$subscription_body" --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" "$subscription_url/info")"
case "$subscription_status" in
  200)
    ;;
  404)
    # The bounded retry horizon covers a slow Agent Sandbox start without redelivering a held event.
    jq -n --argjson maxSubscribers "$KURRENTDB_BOOTSTRAP_MAX_SUBSCRIBERS" '{
      resolveLinktos: false,
      startFrom: 0,
      messageTimeoutMilliseconds: 60000,
      extraStatistics: false,
      maxRetryCount: 60,
      liveBufferSize: 500,
      bufferSize: 500,
      readBatchSize: 20,
      checkPointAfterMilliseconds: 1000,
      minCheckPointCount: 10,
      maxCheckPointCount: 1000,
      maxSubscriberCount: $maxSubscribers,
      namedConsumerStrategy: "RoundRobin"
    }' > "$subscription_body"
    create_subscription_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --header "@$admin_authorization_header" --request PUT --header 'Content-Type: application/json' --data-binary "@$subscription_body" "$subscription_url")"
    if [ "$create_subscription_status" != "201" ] && [ "$create_subscription_status" != "200" ]; then
      echo "KurrentDB refused creation of the conversation-computer activation subscription (HTTP $create_subscription_status)." >&2
      exit 1
    fi
    ;;
  *)
    echo "KurrentDB did not return an expected activation-subscription status (HTTP $subscription_status)." >&2
    exit 1
    ;;
esac
service_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --cacert "$ca_file" --header "@$service_authorization_header" --header 'Accept: application/json' "$endpoint/streams/opencrane-history-bootstrap-probe")"
if [ "$service_status" != "200" ] && [ "$service_status" != "404" ]; then
  echo "The KurrentDB service credential cannot read the default HistoryStore stream boundary." >&2
  exit 1
fi
