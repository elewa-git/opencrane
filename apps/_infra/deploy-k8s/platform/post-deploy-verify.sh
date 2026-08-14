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

# Reject a Helm success that leaves a stale, missing, or unavailable browser build. This check is
# separate from the advisory endpoint diagnostics because onboarding must not claim readiness when
# the same-release SPA has not actually rolled out.
_verify_control_plane_spa_rollout() {
  local available_replicas
  local conditions
  local deployment
  local desired_replicas
  local expected_digest
  local observed_image
  local observed_image_ids
  local ready_replicas
  local unavailable_replicas
  local updated_replicas
  if [[ -z "${CONTROL_PLANE_SPA_IMAGE:-}" ]]; then
    err "OpenCrane SPA rollout cannot be verified because its desired image was not resolved."
    return 1
  fi
  if ! deployment="$(kubectl get "deployment/${RELEASE}-opencrane-ui-spa" -n "$NAMESPACE" -o json)"; then
    err "OpenCrane SPA Deployment '${RELEASE}-opencrane-ui-spa' is missing or cannot be read."
    return 1
  fi
  observed_image="$(jq -r '.spec.template.spec.containers[] | select(.name == "opencrane-ui-spa") | .image // empty' <<<"$deployment")"
  desired_replicas="$(jq -r '.spec.replicas // 1' <<<"$deployment")"
  updated_replicas="$(jq -r '.status.updatedReplicas // 0' <<<"$deployment")"
  ready_replicas="$(jq -r '.status.readyReplicas // 0' <<<"$deployment")"
  available_replicas="$(jq -r '.status.availableReplicas // 0' <<<"$deployment")"
  unavailable_replicas="$(jq -r '.status.unavailableReplicas // 0' <<<"$deployment")"
  conditions="$(jq -r '[.status.conditions[]? | "\(.type)=\(.status) reason=\(.reason // "none") message=\(.message // "none")"] | join("; ")' <<<"$deployment")"
  observed_image_ids="$(kubectl get pods -n "$NAMESPACE" \
    -l "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=opencrane-ui-spa" -o json \
    | jq -r '[.items[].status.containerStatuses[]? | select(.name == "opencrane-ui-spa") | .imageID // empty] | unique | join(", ")')"

  log "OpenCrane SPA rollout: desired image=$CONTROL_PLANE_SPA_IMAGE observed image=${observed_image:-missing} replicas desired=$desired_replicas updated=$updated_replicas ready=$ready_replicas available=$available_replicas unavailable=$unavailable_replicas"
  log "OpenCrane SPA observed image IDs: ${observed_image_ids:-missing}"
  log "OpenCrane SPA rollout conditions: ${conditions:-none}"
  if [[ "$observed_image" != "$CONTROL_PLANE_SPA_IMAGE" ]]; then
    err "OpenCrane SPA rollout uses '${observed_image:-no image}' instead of '$CONTROL_PLANE_SPA_IMAGE'."
    return 1
  fi
  if [[ "$updated_replicas" != "$desired_replicas" || "$ready_replicas" != "$desired_replicas" \
    || "$available_replicas" != "$desired_replicas" || "$unavailable_replicas" != "0" ]]; then
    err "OpenCrane SPA rollout is not fully available. Check Deployment '${RELEASE}-opencrane-ui-spa' and the reported rollout conditions."
    return 1
  fi
  if [[ -z "$observed_image_ids" ]]; then
    err "OpenCrane SPA rollout has no observed container image ID."
    return 1
  fi
  expected_digest="${CONTROL_PLANE_SPA_IMAGE##*@}"
  if [[ "$expected_digest" == sha256:* && "$observed_image_ids" != *"$expected_digest"* ]]; then
    err "OpenCrane SPA Pod image IDs do not include the deployed digest '$expected_digest'."
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
