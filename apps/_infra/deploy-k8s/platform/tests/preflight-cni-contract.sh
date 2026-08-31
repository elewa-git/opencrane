#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
CNI_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/network-policy-cni.sh"

# Load the production matcher without executing the deployment entrypoint.
source "$CNI_HELPER"
declare -F _network_policy_enforcing_cni_detected >/dev/null
declare -F _network_policy_enforcing_cni_display_names >/dev/null
declare -F _network_policy_enforcing_cni_daemonset_names >/dev/null

_expect_accepted() {
  local daemonset_name="$1"
  if ! printf '%s\n' "$daemonset_name" | _network_policy_enforcing_cni_detected; then
    echo "preflight rejected NetworkPolicy-enforcing CNI DaemonSet '$daemonset_name'" >&2
    exit 1
  fi
}

while IFS= read -r daemonset_name; do
  _expect_accepted "daemonset.apps/$daemonset_name"
done < <(_network_policy_enforcing_cni_daemonset_names)

for daemonset_name in \
  daemonset.apps/anetd-helper \
  daemonset.apps/anetd-metrics \
  daemonset.apps/anetd-operator \
  daemonset.apps/antrea-agent-helper \
  daemonset.apps/calico-node-metrics \
  daemonset.apps/cilium-operator \
  daemonset.apps/fluentbit-gke \
  daemonset.apps/kube-router-metrics \
  daemonset.apps/not-anetd \
  daemonset.apps/weave-net-helper; do
  if printf '%s\n' "$daemonset_name" | _network_policy_enforcing_cni_detected; then
    echo "preflight accepted unrelated DaemonSet '$daemonset_name' as an enforcing CNI" >&2
    exit 1
  fi
done

grep -Fq 'kubectl get ds -n kube-system -o name 2>/dev/null | _network_policy_enforcing_cni_detected' "$DEPLOY_SCRIPT"
grep -Fq 'source "$SCRIPT_DIR/network-policy-cni.sh"' "$DEPLOY_SCRIPT"
test "$(grep -Fc '$(_network_policy_enforcing_cni_display_names)' "$DEPLOY_SCRIPT")" -eq 2
test -n "$(_network_policy_enforcing_cni_display_names)"

echo "preflight CNI contract: PASS"
