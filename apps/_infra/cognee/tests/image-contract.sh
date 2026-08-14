#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/_infra/cognee/deploy/Dockerfile"
extension_sha="8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114"
extension_url="http://extension.ladybugdb.com/v0.17.0/linux_amd64/json/libjson.lbug_extension"
extension_path="/root/.lbdb/extension/v0.17.0/linux_amd64/json/libjson.lbug_extension"

grep -Fqx "FROM --platform=linux/amd64 cognee/cognee:1.2.1" "$dockerfile"
grep -Fq "ADD --checksum=sha256:${extension_sha}" "$dockerfile"
grep -Fq "$extension_path" "$dockerfile"
grep -Fq "ENV HOME=/root" "$dockerfile"
grep -Fq 'test "${TARGETARCH:-amd64}" = "amd64"' "$dockerfile"

[[ "$(grep -Fc "$extension_url" "$dockerfile")" -eq 1 ]]
