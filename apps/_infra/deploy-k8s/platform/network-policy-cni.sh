#!/usr/bin/env bash

# Keep operator-facing and DaemonSet names together so diagnostics cannot drift from the matcher.
# Full-name comparison prevents CNI operators and metrics exporters from passing this check.
readonly -a _NETWORK_POLICY_ENFORCING_CNI_RULES=(
  "calico|calico-node"
  "cilium|cilium"
  "weave|weave-net"
  "antrea|antrea-agent"
  "kube-router|kube-router"
  "anetd|anetd"
)

_network_policy_enforcing_cni_display_names() {
  local rule
  local display_name
  local separator=""
  for rule in "${_NETWORK_POLICY_ENFORCING_CNI_RULES[@]}"; do
    display_name="${rule%%|*}"
    printf '%s%s' "$separator" "$display_name"
    separator="/"
  done
}

_network_policy_enforcing_cni_daemonset_names() {
  local rule
  for rule in "${_NETWORK_POLICY_ENFORCING_CNI_RULES[@]}"; do
    printf '%s\n' "${rule#*|}"
  done
}

_network_policy_enforcing_cni_detected() {
  local daemonset_resource
  local daemonset_name
  local rule
  local supported_name
  while IFS= read -r daemonset_resource; do
    daemonset_name="${daemonset_resource##*/}"
    for rule in "${_NETWORK_POLICY_ENFORCING_CNI_RULES[@]}"; do
      supported_name="${rule#*|}"
      if [[ "$daemonset_name" == "$supported_name" ]]; then
        return 0
      fi
    done
  done
  return 1
}
