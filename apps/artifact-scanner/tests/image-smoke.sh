#!/usr/bin/env bash
set -euo pipefail

image="opencrane-artifact-scanner:smoke"
runtime_log="$(mktemp)"
trap 'rm -f "$runtime_log"' EXIT

docker build -t "$image" -f apps/artifact-scanner/deploy/Dockerfile .
set +e
docker run --rm --network none "$image" >"$runtime_log" 2>&1
runtime_result=$?
set -e

if test "$runtime_result" -eq 0; then
  cat "$runtime_log" >&2
  printf "artifact scanner unexpectedly started without configuration\n" >&2
  exit 1
fi
if grep -Fq "ERR_MODULE_NOT_FOUND" "$runtime_log"; then
  cat "$runtime_log" >&2
  exit 1
fi
first_config_error="$(grep -oE '[A-Z][A-Z0-9_]+ is required' "$runtime_log" | head -n 1 || true)"
if test "$first_config_error" != "OPENCRANE_INTERNAL_URL is required"; then
  cat "$runtime_log" >&2
  printf "artifact scanner did not reach its first required configuration check\n" >&2
  exit 1
fi
printf "offline artifact-scanner startup reached its first required configuration check\n"

docker run --rm --network none --entrypoint /bin/sh "$image" -ec '
  test "$(id -u)" = 65532
  test -x /usr/bin/clamscan
  test -n "$(find /var/lib/clamav -maxdepth 1 -type f -readable -print -quit)"
  printf "scanner uid=65532; executable=/usr/bin/clamscan; readable database=/var/lib/clamav\n"
  node --version
  /usr/bin/clamscan --database=/var/lib/clamav --version
  printf clean > /tmp/clean.txt
  /usr/bin/clamscan --database=/var/lib/clamav --infected --no-summary /tmp/clean.txt
  printf "offline clean-file scan passed\n"
'
docker run --rm --network none --entrypoint /bin/sh "$image" -ec '
  printf %s "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=" | base64 -d > /tmp/eicar.com
  set +e
  /usr/bin/clamscan --database=/var/lib/clamav --infected --no-summary /tmp/eicar.com > /tmp/scan.txt 2>&1
  result=$?
  set -e
  if test "$result" != 1 || ! grep -Fq "Eicar-Test-Signature FOUND" /tmp/scan.txt; then
    cat /tmp/scan.txt >&2
    exit 1
  fi
  printf "offline EICAR scan returned malicious verdict 1\n"
'
