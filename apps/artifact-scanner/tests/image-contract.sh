#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/artifact-scanner/deploy/Dockerfile"
helm_template="apps/artifact-scanner/helm/templates/_resources.tpl"

grep -Eq '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS build$' "$dockerfile"
grep -Eq '^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS runtime-dependencies$' "$dockerfile"
grep -Eq '^FROM clamav/clamav-debian:1\.5\.2@sha256:[a-f0-9]{64}$' "$dockerfile"
grep -Fxq 'RUN chmod -R a+rX /var/lib/clamav' "$dockerfile"
grep -Fxq 'USER 65532:65532' "$dockerfile"
grep -Fxq 'ENTRYPOINT ["/usr/local/bin/node"]' "$dockerfile"
grep -Fxq 'CMD ["dist/apps/artifact-scanner/index.js"]' "$dockerfile"
grep -Fq 'value: /usr/bin/clamscan' "$helm_template"
grep -Fq 'value: /var/lib/clamav' "$helm_template"
grep -Fq '"image-smoke"' apps/artifact-scanner/project.json
grep -Fq 'bash apps/artifact-scanner/tests/image-smoke.sh' apps/artifact-scanner/project.json
