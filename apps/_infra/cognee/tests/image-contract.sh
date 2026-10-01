#!/usr/bin/env bash
set -euo pipefail

dockerfile="apps/_infra/cognee/deploy/Dockerfile"
extension_sha="39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426"
extension_url="https://extension.ladybugdb.com/v0.19.0/linux_amd64/json/libjson.lbug_extension"
extension_path="/app/.lbdb/extension/0.19.0/linux_amd64/json/libjson.lbug_extension"

grep -Fqx "FROM --platform=linux/amd64 cognee/cognee@sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10" "$dockerfile"
grep -Fq -- "--checksum=sha256:${extension_sha}" "$dockerfile"
grep -Fq "$extension_path" "$dockerfile"
grep -Fq "COPY --chmod=0644 apps/_infra/cognee/deploy/patches/*.patch" "$dockerfile"
grep -Fq "USER cognee" "$dockerfile"

[[ "$(grep -Fc "$extension_url" "$dockerfile")" -eq 1 ]]
