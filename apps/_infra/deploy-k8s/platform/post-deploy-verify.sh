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

# Reject a Helm success that leaves a stale, missing, or unavailable digest-pinned workload. This
# stays separate from advisory endpoint diagnostics: a release must not claim readiness until the
# exact reviewed image is running and available.
_verify_digest_pinned_deployment_rollout() {
  local display_name="$1"
  local desired_image="$2"
  local deployment_name="$3"
  local container_name="$4"
  local component_label="$5"
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
  if [[ -z "$desired_image" ]]; then
    err "$display_name rollout cannot be verified because its desired image was not resolved."
    return 1
  fi
  if ! deployment="$(kubectl get "deployment/$deployment_name" -n "$NAMESPACE" -o json)"; then
    err "$display_name Deployment '$deployment_name' is missing or cannot be read."
    return 1
  fi
  observed_image="$(jq -r --arg container "$container_name" '.spec.template.spec.containers[] | select(.name == $container) | .image // empty' <<<"$deployment")"
  desired_replicas="$(jq -r '.spec.replicas // 1' <<<"$deployment")"
  updated_replicas="$(jq -r '.status.updatedReplicas // 0' <<<"$deployment")"
  ready_replicas="$(jq -r '.status.readyReplicas // 0' <<<"$deployment")"
  available_replicas="$(jq -r '.status.availableReplicas // 0' <<<"$deployment")"
  unavailable_replicas="$(jq -r '.status.unavailableReplicas // 0' <<<"$deployment")"
  conditions="$(jq -r '[.status.conditions[]? | "\(.type)=\(.status) reason=\(.reason // "none") message=\(.message // "none")"] | join("; ")' <<<"$deployment")"
  observed_image_ids="$(kubectl get pods -n "$NAMESPACE" \
    -l "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=${component_label}" -o json \
    | jq -r --arg container "$container_name" '[.items[].status.containerStatuses[]? | select(.name == $container) | .imageID // empty] | unique | join(", ")')"

  log "$display_name rollout: desired image=$desired_image observed image=${observed_image:-missing} replicas desired=$desired_replicas updated=$updated_replicas ready=$ready_replicas available=$available_replicas unavailable=$unavailable_replicas"
  log "$display_name observed image IDs: ${observed_image_ids:-missing}"
  log "$display_name rollout conditions: ${conditions:-none}"
  if [[ "$observed_image" != "$desired_image" ]]; then
    err "$display_name rollout uses '${observed_image:-no image}' instead of '$desired_image'."
    return 1
  fi
  if [[ "$updated_replicas" != "$desired_replicas" || "$ready_replicas" != "$desired_replicas" \
    || "$available_replicas" != "$desired_replicas" || "$unavailable_replicas" != "0" ]]; then
    err "$display_name rollout is not fully available. Check Deployment '$deployment_name' and the reported rollout conditions."
    return 1
  fi
  if [[ -z "$observed_image_ids" ]]; then
    err "$display_name rollout has no observed container image ID."
    return 1
  fi
  expected_digest="${desired_image##*@}"
  if [[ "$expected_digest" == sha256:* && "$observed_image_ids" != *"$expected_digest"* ]]; then
    err "$display_name Pod image IDs do not include the deployed digest '$expected_digest'."
    return 1
  fi
}

_verify_control_plane_spa_rollout() {
  _verify_digest_pinned_deployment_rollout \
    "OpenCrane SPA" \
    "${CONTROL_PLANE_SPA_IMAGE:-}" \
    "${RELEASE}-opencrane-ui-spa" \
    "opencrane-ui-spa" \
    "opencrane-ui-spa"
}

_verify_cognee_rollout() {
  _verify_digest_pinned_deployment_rollout \
    "Cognee" \
    "${COGNEE_IMAGE:-}" \
    "${RELEASE}-cognee" \
    "cognee" \
    "cognee"
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
