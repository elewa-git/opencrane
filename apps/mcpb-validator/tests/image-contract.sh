#!/usr/bin/env bash
set -euo pipefail
dockerfile='apps/mcpb-validator/deploy/Dockerfile'
grep -Eq '^FROM python:3\.13-alpine@sha256:[a-f0-9]{64}$' "$dockerfile"
grep -Fq 'USER 65532:65532' "$dockerfile"
grep -Fq 'CMD ["python", "-B", "/app/mcpb_validator.py"]' "$dockerfile"
grep -Fq -- '--network none --read-only --user 65532:65532' apps/mcpb-validator/tests/image-smoke.sh
