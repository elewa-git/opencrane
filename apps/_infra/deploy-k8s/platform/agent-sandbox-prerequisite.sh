#!/usr/bin/env bash

# Manages the Agent Sandbox controller as a cluster prerequisite without giving a silo ownership of
# the controller, its CRDs, or its cross-namespace RBAC.

resource_is_expected_manifest_residue()
{
  local resource="$1" release="$2" namespace="$3"
  local managed_by owner_release
  managed_by="$(kubectl --context "$EXPECTED_CONTEXT" --namespace "$namespace" get "$resource" \
    --output=jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
  owner_release="$(kubectl --context "$EXPECTED_CONTEXT" --namespace "$namespace" get "$resource" \
    --output=jsonpath='{.metadata.annotations.opencrane\.ai/prerequisite-release}')"
  [[ "$managed_by" == "opencrane-prerequisite-bootstrap" && "$owner_release" == "$release" ]]
}

assert_absent_manifest_is_clean()
{
  local release="$1" namespace="$2"
  shift 2

  if resource_exists namespace "$namespace"; then
    namespace_is_bootstrap_owned "$namespace" "$release" || fail \
      "namespace '$namespace' exists without bootstrap ownership for '$release'; refusing to adopt it"
  fi

  local resource
  for resource in "$@"; do
    if resource_exists --namespace "$namespace" "$resource"; then
      resource_is_expected_manifest_residue "$resource" "$release" "$namespace" || fail \
        "resource '$resource' exists without bootstrap ownership for '$release'; refusing to adopt it"
    fi
  done
}

prepare_agent_sandbox_manifest()
{
  local downloaded_manifest actual_sha256
  downloaded_manifest="$CHART_CACHE_DIR/agent-sandbox-${AGENT_SANDBOX_VERSION}.yaml"
  AGENT_SANDBOX_MANIFEST="$CHART_CACHE_DIR/agent-sandbox-${AGENT_SANDBOX_VERSION}-pinned.yaml"

  curl --fail --location --silent --show-error \
    --output "$downloaded_manifest" \
    "$AGENT_SANDBOX_MANIFEST_URL"
  actual_sha256="$(sha256_file "$downloaded_manifest")"
  [[ "$actual_sha256" == "$AGENT_SANDBOX_MANIFEST_SHA256" ]] || fail \
    "Agent Sandbox manifest has SHA-256 '$actual_sha256', expected '$AGENT_SANDBOX_MANIFEST_SHA256'"

  sed \
    "s|registry.k8s.io/agent-sandbox/agent-sandbox-controller:${AGENT_SANDBOX_VERSION}|${AGENT_SANDBOX_CONTROLLER_IMAGE}|" \
    "$downloaded_manifest" >"$AGENT_SANDBOX_MANIFEST"
  grep -Fq "image: $AGENT_SANDBOX_CONTROLLER_IMAGE" "$AGENT_SANDBOX_MANIFEST" || fail \
    "Agent Sandbox release manifest did not contain its expected controller image tag"
  grep -Fxq '        - --extensions' "$AGENT_SANDBOX_MANIFEST" || fail \
    "Agent Sandbox release manifest does not enable extension reconcilers"
}

mark_agent_sandbox_manifest_resources()
{
  local resource
  for resource in "${AGENT_SANDBOX_CLUSTER_RESOURCES[@]}" "${AGENT_SANDBOX_NAMESPACE_RESOURCES[@]}"; do
    kubectl --context "$EXPECTED_CONTEXT" --namespace "$AGENT_SANDBOX_NAMESPACE" label "$resource" \
      app.kubernetes.io/managed-by=opencrane-prerequisite-bootstrap --overwrite >/dev/null
    kubectl --context "$EXPECTED_CONTEXT" --namespace "$AGENT_SANDBOX_NAMESPACE" annotate "$resource" \
      "opencrane.ai/prerequisite-release=$AGENT_SANDBOX_RELEASE" --overwrite >/dev/null
  done
}

install_agent_sandbox_prerequisite()
{
  log "installing Agent Sandbox $AGENT_SANDBOX_VERSION..."
  ensure_bootstrap_namespace "$AGENT_SANDBOX_NAMESPACE" "$AGENT_SANDBOX_RELEASE"
  kubectl --context "$EXPECTED_CONTEXT" apply \
    --server-side \
    --field-manager=opencrane-prerequisite-bootstrap \
    --filename "$AGENT_SANDBOX_MANIFEST" >/dev/null
  mark_agent_sandbox_manifest_resources
}

verify_agent_sandbox_prerequisite()
{
  kubectl --context "$EXPECTED_CONTEXT" --namespace "$AGENT_SANDBOX_NAMESPACE" \
    rollout status deployment/agent-sandbox-controller --timeout=5m
  wait_for_established_crds "${AGENT_SANDBOX_CLUSTER_RESOURCES[@]}"

  local crd version_state
  for crd in "${AGENT_SANDBOX_V1BETA1_CRDS[@]}"; do
    version_state="$(kubectl --context "$EXPECTED_CONTEXT" get crd "$crd" \
      --output='jsonpath={range .spec.versions[?(@.name=="v1beta1")]}{.served}:{.storage}{end}')"
    [[ "$version_state" == "true:true" ]] || fail \
      "Agent Sandbox CRD '$crd' must serve and store v1beta1 resources"
  done

  local controller_image controller_args
  controller_image="$(kubectl --context "$EXPECTED_CONTEXT" --namespace "$AGENT_SANDBOX_NAMESPACE" \
    get deployment agent-sandbox-controller \
    --output=jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "$controller_image" == "$AGENT_SANDBOX_CONTROLLER_IMAGE" ]] || fail \
    "Agent Sandbox controller image is '$controller_image', expected '$AGENT_SANDBOX_CONTROLLER_IMAGE'"
  controller_args="$(kubectl --context "$EXPECTED_CONTEXT" --namespace "$AGENT_SANDBOX_NAMESPACE" \
    get deployment agent-sandbox-controller \
    --output=jsonpath='{range .spec.template.spec.containers[0].args[*]}{.}{"\\n"}{end}')"
  grep -Fx -- '--extensions' <<<"$controller_args" >/dev/null || fail \
    "Agent Sandbox controller does not enable extension reconcilers"
}
