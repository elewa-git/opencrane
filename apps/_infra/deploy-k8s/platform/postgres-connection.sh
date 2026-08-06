#!/usr/bin/env bash

# Publishes an app-specific URI without exposing credentials to the deploy engine's shell.
publish_postgres_database_connection()
{
  local publisher="$1" namespace="$2" credentials_secret="$3" app_secret="$4" host="$5" database_name="$6" connection_options="${7:-}"
  local publisher_args=("$namespace" "$credentials_secret" "$app_secret" "$host" "$database_name")
  [[ -n "$connection_options" ]] && publisher_args+=("$connection_options")
  bash "$publisher" "${publisher_args[@]}"
}

# Secret-backed environment variables are read only when a container starts. Restart only the
# named database consumers after the installer republishes their per-authority connection URIs.
restart_postgres_connection_consumers()
{
  local namespace="$1" timeout="$2"
  shift 2

  local deployment
  for deployment in "$@"; do
    if kubectl get "deployment/$deployment" -n "$namespace" >/dev/null 2>&1; then
      kubectl rollout restart "deployment/$deployment" -n "$namespace"
    fi
  done

  for deployment in "$@"; do
    if kubectl get "deployment/$deployment" -n "$namespace" >/dev/null 2>&1; then
      kubectl rollout status "deployment/$deployment" -n "$namespace" --timeout="${timeout}s"
    fi
  done
}
