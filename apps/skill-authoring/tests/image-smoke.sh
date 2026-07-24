#!/usr/bin/env bash
set -euo pipefail

image="opencrane-skill-authoring-validator:smoke"
export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"

docker build -t "$image" -f apps/skill-authoring/deploy/Dockerfile .
docker run --rm --network none --no-healthcheck --entrypoint /bin/sh "$image" -ec '
  test "$(id -u)" = 65532
  test ! -w /opt/opencrane/clamav-db
  ruff --version
  mypy --version
  pytest --version
  printf clean > /tmp/clean.txt
  clamscan --database=/opt/opencrane/clamav-db --infected --no-summary /tmp/clean.txt
  ! ps | grep -E "[f]reshclam|[c]lamd"
'
docker run --rm --network none --no-healthcheck --entrypoint /bin/sh "$image" -ec '
  printf %s "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=" | base64 -d > /tmp/eicar.com
  set +e
  clamscan --database=/opt/opencrane/clamav-db --infected --no-summary /tmp/eicar.com > /tmp/scan.txt 2>&1
  result=$?
  set -e
  if test "$result" != 1 || ! grep -Fq "Eicar-Signature FOUND" /tmp/scan.txt; then
    cat /tmp/scan.txt >&2
    exit 1
  fi
'
