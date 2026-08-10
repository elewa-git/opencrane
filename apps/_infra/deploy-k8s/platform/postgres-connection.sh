#!/usr/bin/env bash

# Publishes an app-specific URI without exposing credentials to the deploy engine's shell.
publish_postgres_database_connection()
{
  local publisher="$1" namespace="$2" credentials_secret="$3" app_secret="$4" host="$5" database_name="$6" connection_options="${7:-}"
  local publisher_args=("$namespace" "$credentials_secret" "$app_secret" "$host" "$database_name")
  [[ -n "$connection_options" ]] && publisher_args+=("$connection_options")
  bash "$publisher" "${publisher_args[@]}"
}
