#!/usr/bin/env bash
set -euo pipefail

# Exercise the installed controller in the disposable CI cluster, without admitting a product run.
CONTEXT="${1:?The smoke requires an explicit disposable Kubernetes context}"
NAMESPACE="${2:?The smoke requires its installed namespace}"
RELEASE="${3:?The smoke requires its installed release}"
TIMEOUT_SECONDS="${4:-180}"
if [[ "$CONTEXT" != k3d-* || ! "$NAMESPACE" =~ ^[a-z0-9][a-z0-9-]*$ || ! "$RELEASE" =~ ^[a-z0-9][a-z0-9-]*$ || ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'The controller fixture requires a disposable k3d context and valid namespace, release and timeout.\n' >&2
  exit 2
fi
SERVER="system:serviceaccount:${NAMESPACE}:${RELEASE}-opencrane-server"
CLAIM_NAME='computer-controller-proof-g1'
CLAIM_UID=''
SANDBOX_NAME=''
SERVICE_NAME=''
LEASE_LABELS='{"opencrane.ai/computer-id":"computer-controller-proof","opencrane.ai/computer-generation":"1","opencrane.ai/computer-lease-id":"lease-controller-proof"}'
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))

# UID preconditions prevent this fixture's cleanup from deleting a same-name replacement.
cleanup_claim()
{
  if [[ -z "$CLAIM_UID" ]]; then
    return 0
  fi
  local options
  options="$(jq -n --arg uid "$CLAIM_UID" '{apiVersion:"v1",kind:"DeleteOptions",propagationPolicy:"Foreground",preconditions:{uid:$uid}}')"
  if ! kubectl --context "$CONTEXT" --as "$SERVER" delete \
    --raw "/apis/extensions.agents.x-k8s.io/v1beta1/namespaces/${NAMESPACE}/sandboxclaims/${CLAIM_NAME}" -f - <<<"$options" >/dev/null; then
    return 1
  fi
  CLAIM_UID=''
  kubectl --context "$CONTEXT" wait --for=delete "sandboxclaim/${CLAIM_NAME}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s" >/dev/null || return 1
  if [[ -n "$SANDBOX_NAME" ]]; then
    kubectl --context "$CONTEXT" wait --for=delete "sandbox/${SANDBOX_NAME}" "pod/${SANDBOX_NAME}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s" >/dev/null || return 1
  fi
  if [[ -n "$SERVICE_NAME" ]]; then
    kubectl --context "$CONTEXT" wait --for=delete "service/${SERVICE_NAME}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s" >/dev/null || return 1
  fi
}
trap 'status=$?; cleanup_claim || status=1; exit "$status"' EXIT

CLAIM="$(jq -n --arg namespace "$NAMESPACE" --arg name "$CLAIM_NAME" --argjson labels "$LEASE_LABELS" '{
  apiVersion:"extensions.agents.x-k8s.io/v1beta1",kind:"SandboxClaim",
  metadata:{name:$name,namespace:$namespace,
    labels:($labels + {"opencrane.ai/silo-id":"controller-proof","opencrane.ai/profile":"developer"}),
    annotations:{"opencrane.ai/lease-reason":"activation_requested"}},
  spec:{warmPoolRef:{name:"developer-pool"},
    lifecycle:{shutdownPolicy:"DeleteForeground",shutdownTime:(now | floor + 600 | todateiso8601)},
    additionalPodMetadata:{labels:$labels}}
}')"
# Create fails if this fixture name already exists; the smoke never adopts or overwrites it.
CREATED="$(kubectl --context "$CONTEXT" --as "$SERVER" create -f - -o json <<<"$CLAIM")"
CLAIM_UID="$(jq -er '.metadata.uid | select(type == "string" and length > 0)' <<<"$CREATED")"
while true; do
  CLAIM="$(kubectl --context "$CONTEXT" get "sandboxclaim/${CLAIM_NAME}" -n "$NAMESPACE" -o json)"
  jq -e --arg uid "$CLAIM_UID" '.metadata.uid == $uid' <<<"$CLAIM" >/dev/null
  if jq -e '.status.conditions // [] | any(.reason == "InvalidMetadata")' <<<"$CLAIM" >/dev/null; then
    jq '.status.conditions' <<<"$CLAIM" >&2
    exit 1
  fi
  SANDBOX_NAME="$(jq -r '.status.sandbox.name // empty' <<<"$CLAIM")"
  if [[ -n "$SANDBOX_NAME" ]]; then
    if [[ ! "$SANDBOX_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      printf 'The fixture claim reported an invalid Sandbox name.\n' >&2
      exit 1
    fi
    SANDBOX="$(kubectl --context "$CONTEXT" get "sandbox/${SANDBOX_NAME}" -n "$NAMESPACE" -o json --ignore-not-found)"
    POD="$(kubectl --context "$CONTEXT" get "pod/${SANDBOX_NAME}" -n "$NAMESPACE" -o json --ignore-not-found)"
    if [[ -n "$SANDBOX" && -n "$POD" ]]; then
      jq -e --arg uid "$CLAIM_UID" --arg name "$CLAIM_NAME" --arg namespace "$NAMESPACE" --arg sandbox "$SANDBOX_NAME" --argjson labels "$LEASE_LABELS" '
        [.metadata.ownerReferences[]? | select(.controller == true)] as $owners |
        .apiVersion == "agents.x-k8s.io/v1beta1" and .kind == "Sandbox" and
        .metadata.name == $sandbox and .metadata.namespace == $namespace and
        ($owners | length) == 1 and $owners[0].uid == $uid and $owners[0].name == $name and
        $owners[0].apiVersion == "extensions.agents.x-k8s.io/v1beta1" and $owners[0].kind == "SandboxClaim" and
        (.spec.podTemplate.metadata.labels as $actual | $labels | to_entries | all($actual[.key] == .value))
      ' <<<"$SANDBOX" >/dev/null
      SANDBOX_UID="$(jq -er '.metadata.uid' <<<"$SANDBOX")"
      jq -e --arg uid "$SANDBOX_UID" --arg name "$SANDBOX_NAME" --arg namespace "$NAMESPACE" --arg account "${RELEASE}-agent-sandbox" --argjson labels "$LEASE_LABELS" '
        [.metadata.ownerReferences[]? | select(.controller == true)] as $owners |
        .metadata.name == $name and .metadata.namespace == $namespace and
        ($owners | length) == 1 and $owners[0].uid == $uid and $owners[0].name == $name and
        $owners[0].apiVersion == "agents.x-k8s.io/v1beta1" and $owners[0].kind == "Sandbox" and
        .spec.serviceAccountName == $account and .spec.runtimeClassName == "opencrane-smoke-runc" and
        .spec.dnsPolicy == "ClusterFirst" and .spec.dnsConfig == null and
        .metadata.labels["app.kubernetes.io/component"] == "agent-sandbox" and
        (.metadata.labels as $actual | $labels | to_entries | all($actual[.key] == .value))
      ' <<<"$POD" >/dev/null
      SERVICE_NAME="$(jq -r '.status.service // empty' <<<"$SANDBOX")"
      if [[ -n "$SERVICE_NAME" ]] && jq -e '.status.phase == "Running"' <<<"$POD" >/dev/null; then
        jq -e --arg namespace "$NAMESPACE" '
          .status.service | test("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")
        ' <<<"$SANDBOX" >/dev/null
        jq -e --arg namespace "$NAMESPACE" '.status.serviceFQDN == (.status.service + "." + $namespace + ".svc.cluster.local")' <<<"$SANDBOX" >/dev/null
        break
      fi
    fi
  fi
  if [[ $(date +%s) -ge "$DEADLINE" ]]; then
    printf 'The controller did not realize the fixture claim, owned running Pod and Service address before the timeout.\n' >&2
    jq '.status' <<<"$CLAIM" >&2
    exit 1
  fi
  sleep 2
done

# Resolve and connect to the private listener without presenting a token or invoking a product command.
kubectl --context "$CONTEXT" exec -i "$SANDBOX_NAME" -n "$NAMESPACE" --container=conversation-computer -- python3 - <<'PY'
import os
import socket
import urllib.parse

endpoint = urllib.parse.urlparse(os.environ["OPENCRANE_INTERNAL_ENDPOINT"])
socket.setdefaulttimeout(10)
addresses = socket.getaddrinfo(endpoint.hostname, endpoint.port, type=socket.SOCK_STREAM)
assert addresses, "The computer cannot resolve its internal server"
with socket.create_connection((endpoint.hostname, endpoint.port), timeout=10):
    pass
print("Computer cluster DNS and private server transport: PASS")
PY
template_policy="$(kubectl --context "$CONTEXT" get "networkpolicy/${RELEASE}-developer-template-network-policy" -n "$NAMESPACE" --ignore-not-found -o name)"
if [[ -n "$template_policy" ]]; then
  printf 'The controller added a second network policy to the release-owned computer policy.\n' >&2
  exit 1
fi
cleanup_claim
printf 'Sandbox controller lifecycle: PASS (owned Sandbox, running Pod, lease labels, cluster DNS, private server transport, Service address and foreground cleanup; no product execution or Ready proof).\n'
