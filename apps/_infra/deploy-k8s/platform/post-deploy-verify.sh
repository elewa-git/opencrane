#!/usr/bin/env bash
# Advisory checks run by k8s-deploy.sh after Helm reports a completed release.

# Read actual UI hosts from the deployed ingresses. The fleet may serve the apex, while a silo
# serves an organisation host, so verification must not assume platform.<base-domain>.
_control_plane_hosts() {
  local hosts
  hosts="$(kubectl get ingress -n "$NAMESPACE" \
    -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}' 2>/dev/null \
    | grep -v '^$' | sort -u)"
  if [[ -n "$hosts" ]]; then
    echo "$hosts"
  elif [[ -n "$BASE_DOMAIN" ]]; then
    echo "platform.$BASE_DOMAIN"
  fi
}

_verify_health_url() {
  local health_url="$1"
  if [[ "$VERIFY_INSECURE" == "1" ]]; then
    curl --silent --show-error --fail --connect-timeout 5 --max-time 10 \
      --insecure "$health_url" >/dev/null
  else
    curl --silent --show-error --fail --connect-timeout 5 --max-time 10 \
      "$health_url" >/dev/null
  fi
}

_wait_for_release_certificate() {
  local certificate lookup
  certificate="${RELEASE}-clustertenant-tls"
  if lookup="$(kubectl get certificate "$certificate" -n "$NAMESPACE" -o name 2>&1)"; then
    kubectl wait --for=condition=Ready "certificate/$certificate" -n "$NAMESPACE" --timeout="${TIMEOUT}s"
  elif [[ "$lookup" != *"(NotFound)"* ]]; then
    printf 'Unable to determine Certificate %s readiness: %s\n' "$certificate" "$lookup" >&2
    return 1
  fi
}

# Verification stays advisory: every failed diagnostic becomes a warning, never a failed release.
_post_deploy_verify() {
  [[ "$VERIFY" == "1" ]] || return 0
  log "Post-deploy verify (advisory — does not fail the install):"

  local notready
  notready="$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running,status.phase!=Succeeded -o name 2>/dev/null | grep -c . || true)"
  if [[ "$notready" == "0" ]]; then
    log "  ✓ all pods Running/Succeeded in $NAMESPACE"
  else
    warn "  ✗ $notready pod(s) not Running in $NAMESPACE — kubectl get pods -n $NAMESPACE"
  fi

  local host resolved
  if command -v dig >/dev/null 2>&1; then
    for host in $(_control_plane_hosts); do
      resolved="$(dig +short "$host" 2>/dev/null | tail -1)"
      if [[ -n "$resolved" ]]; then
        log "  ✓ $host resolves to $resolved"
      else
        warn "  ✗ $host does not resolve yet (DNS propagation lag or a missing record)."
      fi
    done
  fi

  # /healthz is public by design and fails when the server cannot reach its durable database.
  if command -v curl >/dev/null 2>&1; then
    local health_url
    for host in $(_control_plane_hosts); do
      health_url="https://${host}/healthz"
      if _verify_health_url "$health_url"; then
        log "  ✓ $health_url is healthy"
      else
        warn "  ✗ $health_url is unavailable or unhealthy"
      fi
    done
  else
    warn "  ! curl is unavailable — skipping the HTTP health check."
  fi
}
