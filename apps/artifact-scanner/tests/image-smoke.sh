#!/usr/bin/env bash
set -euo pipefail

image="opencrane-artifact-scanner:smoke"

docker build -t "$image" -f apps/artifact-scanner/deploy/Dockerfile .
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
