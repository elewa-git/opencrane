#!/usr/bin/env bash

# Proves that the privileged pg_cron migration removed the temporary CNPG superuser credential.

_database_superuser_access_error()
{
  printf 'database superuser-access proof: %s\n' "$1" >&2
}

verify_database_superuser_access_disabled()
{
  local cluster
  local superuser_secret

  if [[ -z "${NAMESPACE:-}" || -z "${POSTGRES_RELEASE:-}" || ! "${TIMEOUT:-}" =~ ^[1-9][0-9]{0,3}$ ]]; then
    _database_superuser_access_error "namespace, release, or timeout input is invalid"
    return 1
  fi
  if ! cluster="$(kubectl --request-timeout="${TIMEOUT}s" get "cluster/${POSTGRES_RELEASE}" --namespace "$NAMESPACE" -o json)"; then
    _database_superuser_access_error "unable to read CNPG Cluster '$POSTGRES_RELEASE'"
    return 1
  fi
  if ! jq -e '.spec.enableSuperuserAccess == false' <<<"$cluster" >/dev/null; then
    _database_superuser_access_error "CNPG superuser access remains enabled"
    return 1
  fi
  if ! superuser_secret="$(kubectl --request-timeout="${TIMEOUT}s" get "secret/${POSTGRES_RELEASE}-superuser" --namespace "$NAMESPACE" --ignore-not-found -o name)"; then
    _database_superuser_access_error "unable to inventory the CNPG superuser Secret"
    return 1
  fi
  if [[ -n "$superuser_secret" ]]; then
    _database_superuser_access_error "CNPG superuser Secret remains after the privileged migration step"
    return 1
  fi
}
