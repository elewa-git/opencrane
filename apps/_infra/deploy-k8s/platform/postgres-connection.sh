#!/usr/bin/env bash

# Publishes an app-specific URI without exposing credentials to the deploy engine's shell.
publish_postgres_database_connection()
{
  local publisher="$1" namespace="$2" credentials_secret="$3" app_secret="$4" host="$5" database_name="$6" connection_options="${7:-}"
  local publisher_args=("$namespace" "$credentials_secret" "$app_secret" "$host" "$database_name")
  [[ -n "$connection_options" ]] && publisher_args+=("$connection_options")
  bash "$publisher" "${publisher_args[@]}"
}

# GKE Dataplane V2 evaluates a Service ClusterIP before its endpoint Pod selector. Return the
# exact IPv4 Pooler address so the chart can admit only that path on PostgreSQL's port.
discover_postgres_pooler_service_ip()
{
  local namespace="$1" pooler_service="$2" service_ip
  service_ip="$(kubectl get service "$pooler_service" -n "$namespace" -o jsonpath='{.spec.clusterIP}')"
  if [[ ! "$service_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    err "CNPG Pooler Service '$pooler_service' has no IPv4 ClusterIP. This deployment requires a stable IPv4 Pooler Service."
    return 1
  fi
  printf '%s\n' "$service_ip"
}
