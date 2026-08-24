#!/usr/bin/env bash
set -euo pipefail

image="opencrane-postgres:smoke"

docker build --platform linux/amd64 --tag "$image" --file apps/postgres/deploy/Dockerfile .
docker run --rm --network none --platform linux/amd64 --entrypoint /bin/sh "$image" -ceu '
  test "$(id -u)" = 26
  test "$(postgres --version)" = "postgres (PostgreSQL) 17.5 (Debian 17.5-1.pgdg110+1)"
  test -f "$(pg_config --sharedir)/extension/pg_cron.control"
  test -f "$(pg_config --pkglibdir)/pg_cron.so"
  grep -Fq "default_version = '\''1.6'\''" "$(pg_config --sharedir)/extension/pg_cron.control"
  printf "PostgreSQL 17.5 operand contains pg_cron 1.6.7 and retains uid 26.\n"
'
