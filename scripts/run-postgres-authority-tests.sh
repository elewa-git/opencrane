#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <authority-test.sql> [...]" >&2
  exit 2
fi

if command -v psql >/dev/null 2>&1; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required when authority tests use the local psql client" >&2
    exit 2
  fi
  for authority_test in "$@"; do
    psql "$DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file="$authority_test"
  done
elif [ -n "${POSTGRES_TEST_CONTAINER:-}" ] && command -v docker >/dev/null 2>&1; then
  postgres_test_user="${POSTGRES_TEST_USER:-postgres}"
  postgres_test_database="${POSTGRES_TEST_DATABASE:-opencrane}"
  for authority_test in "$@"; do
    docker exec -i "$POSTGRES_TEST_CONTAINER" psql -U "$postgres_test_user" -d "$postgres_test_database" -X -v ON_ERROR_STOP=1 < "$authority_test"
  done
else
  echo "psql or POSTGRES_TEST_CONTAINER plus docker is required for PostgreSQL authority tests" >&2
  exit 2
fi
