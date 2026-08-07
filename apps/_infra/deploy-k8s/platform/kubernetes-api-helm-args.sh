#!/usr/bin/env bash
# Kubernetes API endpoint discovery for workloads whose NetworkPolicy permits TokenReview traffic.

# Populates KUBERNETES_API_HELM_ARGS for one chart-values prefix. The caller owns `err` and must
# copy the result before invoking the function again.
_load_kubernetes_api_helm_args() {
  local values_prefix="$1"
  local workload_name="$2"
  local service_ip service_port endpoint_port endpoint_index endpoint_ip

  service_ip="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.clusterIP}')"
  service_port="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.ports[0].port}')"
  endpoint_port="$(kubectl get endpoints kubernetes -n default -o jsonpath='{.subsets[0].ports[0].port}')"
  if [[ -z "$service_ip" || -z "$service_port" || -z "$endpoint_port" ]]; then
    err "Kubernetes API Service and endpoint addresses are required for bounded $workload_name egress."
    exit 1
  fi

  if [[ "$service_ip" == *:* ]]; then
    service_ip="$service_ip/128"
  else
    service_ip="$service_ip/32"
  fi
  KUBERNETES_API_HELM_ARGS=(
    --set-string "$values_prefix.kubernetesApiServerCidrs[0]=$service_ip"
    --set "$values_prefix.kubernetesApiServerPort=$service_port"
    --set "$values_prefix.kubernetesApiServerEndpointPort=$endpoint_port")

  endpoint_index=0
  while IFS= read -r endpoint_ip; do
    [[ -z "$endpoint_ip" ]] && continue
    if [[ "$endpoint_ip" == *:* ]]; then endpoint_ip="$endpoint_ip/128"; else endpoint_ip="$endpoint_ip/32"; fi
    KUBERNETES_API_HELM_ARGS+=(--set-string "$values_prefix.kubernetesApiServerEndpointCidrs[$endpoint_index]=$endpoint_ip")
    endpoint_index=$((endpoint_index + 1))
  done < <(kubectl get endpoints kubernetes -n default -o jsonpath='{range .subsets[*].addresses[*]}{.ip}{"\n"}{end}')
  if [[ "$endpoint_index" -eq 0 ]]; then
    err "Kubernetes API has no backing endpoints for bounded $workload_name egress."
    exit 1
  fi
}
