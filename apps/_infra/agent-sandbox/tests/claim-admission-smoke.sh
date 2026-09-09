#!/usr/bin/env bash
set -euo pipefail

# Check the installed policy and dry-run fixed admission requests without persisting claims or Pods.
CONTEXT="${1:?The smoke requires an explicit Kubernetes context}"
NAMESPACE="${2:?The smoke requires its installed namespace}"
RELEASE="${3:?The smoke requires its installed release}"
POLICY="${RELEASE}-agent-sandbox-claims"
SERVER="system:serviceaccount:${NAMESPACE}:${RELEASE}-opencrane-server"
CONTROLLER="system:serviceaccount:agent-sandbox-system:agent-sandbox-controller"
DEADLINE=$(( $(date +%s) + 60 ))
POLICY_JSON=""
while true; do
  POLICY_JSON="$(kubectl --context "$CONTEXT" get validatingadmissionpolicy "$POLICY" -o json)"
  if jq -e '.status.observedGeneration == .metadata.generation and (.status | has("typeChecking"))' <<<"$POLICY_JSON" >/dev/null; then
    break
  fi
  if [[ $(date +%s) -ge "$DEADLINE" ]]; then
    printf 'Sandbox policy type checking did not finish for %s.\n' "$POLICY" >&2
    exit 1
  fi
  sleep 2
done
if ! jq -e '(.status.typeChecking.expressionWarnings // []) | length == 0' <<<"$POLICY_JSON" >/dev/null; then
  jq '.status.typeChecking.expressionWarnings' <<<"$POLICY_JSON" >&2
  exit 1
fi

CLAIM="$(jq -n --arg namespace "$NAMESPACE" '{
  apiVersion: "extensions.agents.x-k8s.io/v1beta1", kind: "SandboxClaim",
  metadata: {name: "computer-policy-proof-g1", namespace: $namespace,
    labels: {"opencrane.ai/silo-id": "policy-proof", "opencrane.ai/computer-id": "computer-policy-proof",
      "opencrane.ai/computer-generation": "1", "opencrane.ai/computer-lease-id": "lease-policy-proof",
      "opencrane.ai/profile": "developer"},
    annotations: {"opencrane.ai/lease-reason": "activation_requested"}},
  spec: {warmPoolRef: {name: "developer-pool"},
    lifecycle: {shutdownPolicy: "DeleteForeground", shutdownTime: (now | floor + 3600 | todateiso8601)},
    additionalPodMetadata: {labels: {"opencrane.ai/computer-id": "computer-policy-proof",
      "opencrane.ai/computer-generation": "1", "opencrane.ai/computer-lease-id": "lease-policy-proof"}}}
}')"

# An exact valid claim proves the negative cases are rejected by policy, not an unavailable API.
kubectl --context "$CONTEXT" --as "$SERVER" create --dry-run=server -f - -o name <<<"$CLAIM" >/dev/null

assert_denied()
{
  local actor="$1" candidate="$2" label="$3" result
  if result="$(kubectl --context "$CONTEXT" --as "$actor" create --dry-run=server -f - -o name <<<"$candidate" 2>&1)"; then
    printf 'Sandbox policy admitted forbidden case: %s\n' "$label" >&2
    exit 1
  fi
  if [[ "$result" != *"ValidatingAdmissionPolicy '$POLICY'"* ]]; then
    printf 'Sandbox denial did not come from the installed policy for %s: %s\n' "$label" "$result" >&2
    exit 1
  fi
}

assert_denied "$CONTROLLER" "$CLAIM" 'controller-created claim'
assert_denied "$SERVER" "$(jq '.metadata.annotations["opentelemetry.io/trace-context"] = "forged"' <<<"$CLAIM")" 'caller controller annotation'
assert_denied "$SERVER" "$(jq '.spec.env = [{name: "OPENCRANE_COMPUTER_ID", value: "another-computer"}]' <<<"$CLAIM")" 'environment injection'
assert_denied "$SERVER" "$(jq '.spec.additionalPodMetadata.labels["opencrane.ai/computer-lease-id"] = "another-lease"' <<<"$CLAIM")" 'mismatched Pod lease'
assert_denied "$SERVER" "$(jq '.spec.warmPoolRef.name = "another-pool"' <<<"$CLAIM")" 'foreign pool'
assert_denied "$SERVER" "$(jq '.spec.lifecycle.ttlSecondsAfterFinished = 3600' <<<"$CLAIM")" 'extra lifecycle policy'
if kubectl --context "$CONTEXT" get sandboxclaim computer-policy-proof-g1 -n "$NAMESPACE" -o name --ignore-not-found | grep -q .; then
  printf 'The dry-run admission fixture unexpectedly exists.\n' >&2
  exit 1
fi
printf 'Sandbox installed admission contract: PASS\n'
