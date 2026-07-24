#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/skill-authoring/deploy/Dockerfile"

grep -Eq '^FROM python:3\.13-alpine@sha256:[a-f0-9]{64} AS validator-tools$' "$dockerfile"
grep -Eq '^FROM clamav/clamav:1\.5\.2@sha256:[a-f0-9]{64}$' "$dockerfile"
grep -Fq 'pip install --no-cache-dir --require-hashes --prefix=/opt/opencrane' "$dockerfile"
grep -Fq 'COPY --from=validator-tools /opt/opencrane /opt/opencrane' "$dockerfile"
grep -Fxq 'ENV PYTHONPATH=/opt/opencrane/lib/python3.13/site-packages' "$dockerfile"
grep -Fq 'cp -a /var/lib/clamav/. /opt/opencrane/clamav-db/' "$dockerfile"
grep -Fq 'ln -s /usr/bin/clamscan /opt/opencrane/bin/clamscan' "$dockerfile"
grep -Fq 'chmod -R a-w /opt/opencrane/clamav-db' "$dockerfile"
grep -Fxq 'ENTRYPOINT []' "$dockerfile"
rg -q 'upstream image starts freshclam/clamd' "$dockerfile"
rg -Fq 'bash apps/skill-authoring/tests/image-smoke.sh' apps/skill-authoring/project.json
if ! rg -q -- '--hash=sha256:' apps/skill-authoring/deploy/validator.requirements.txt; then
  echo 'validator lock must contain artifact hashes' >&2
  exit 1
fi
