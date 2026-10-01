#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:?repository root is required}"
OUTPUT_DIR="${2:?output directory is required}"
ARCHIVE_WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$ARCHIVE_WORK_DIR"' EXIT

for command in docker jq openssl tar zip; do
  command -v "$command" >/dev/null 2>&1 || { echo "[hosted-oci-archive] Missing required command: $command" >&2; exit 1; }
done

mkdir -p "$OUTPUT_DIR"
oci_tar="$ARCHIVE_WORK_DIR/producer-oci.tar"
oci_root="$ARCHIVE_WORK_DIR/layout"
mkdir -p "$oci_root"

docker buildx build \
  --file "$ROOT_DIR/apps/mcp-file-generator/deploy/Dockerfile" \
  --output "type=oci,dest=${oci_tar}" \
  "$ROOT_DIR"
tar -xf "$oci_tar" -C "$oci_root"

[[ "$(jq -r '.imageLayoutVersion' "$oci_root/oci-layout")" == "1.0.0" ]] || {
  echo "[hosted-oci-archive] Producer build did not emit OCI Image Layout 1.0.0" >&2
  exit 1
}
[[ "$(jq '.manifests | length' "$oci_root/index.json")" == "1" ]] || {
  echo "[hosted-oci-archive] Producer layout must contain exactly one image manifest" >&2
  exit 1
}

_verify_blob()
{
  local digest="$1" expected_size="$2" hexadecimal path actual_size actual_digest
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "[hosted-oci-archive] Invalid descriptor digest" >&2; return 1; }
  [[ "$expected_size" =~ ^[0-9]+$ ]] || { echo "[hosted-oci-archive] Invalid descriptor size" >&2; return 1; }
  hexadecimal="${digest#sha256:}"
  path="$oci_root/blobs/sha256/$hexadecimal"
  [[ -f "$path" ]] || { echo "[hosted-oci-archive] Missing descriptor blob $digest" >&2; return 1; }
  actual_size="$(wc -c < "$path" | tr -d ' ')"
  actual_digest="$(openssl dgst -sha256 -r "$path" | awk '{print $1}')"
  [[ "$actual_size" == "$expected_size" && "$actual_digest" == "$hexadecimal" ]] || {
    echo "[hosted-oci-archive] Descriptor bytes do not match $digest" >&2
    return 1
  }
}

manifest_digest="$(jq -r '.manifests[0].digest' "$oci_root/index.json")"
manifest_size="$(jq -r '.manifests[0].size' "$oci_root/index.json")"
_verify_blob "$manifest_digest" "$manifest_size"
manifest_path="$oci_root/blobs/sha256/${manifest_digest#sha256:}"
while IFS=$'\t' read -r digest size; do
  _verify_blob "$digest" "$size"
done < <(jq -r '[.config, .layers[]] | .[] | [.digest, (.size | tostring)] | @tsv' "$manifest_path")

archive_path="$OUTPUT_DIR/mcp-file-generator-oci.zip"
(
  cd "$oci_root"
  zip -q -0 -r "$archive_path" oci-layout index.json blobs
)
archive_digest="$(openssl dgst -sha256 -r "$archive_path" | awk '{print $1}')"
archive_size="$(wc -c < "$archive_path" | tr -d ' ')"
expected_csv_path="$OUTPUT_DIR/county-summary.csv"
printf 'County,Customers\r\nNairobi,3\r\nKisumu,2\r\n' > "$expected_csv_path"

jq -n \
  --arg archivePath "$archive_path" \
  --arg archiveDigest "sha256:$archive_digest" \
  --argjson archiveByteLength "$archive_size" \
  --arg imageDigest "$manifest_digest" \
  --arg expectedCsvPath "$expected_csv_path" \
  '{archivePath: $archivePath, archiveDigest: $archiveDigest, archiveByteLength: $archiveByteLength, imageDigest: $imageDigest, expectedCsvPath: $expectedCsvPath}' \
  > "$OUTPUT_DIR/oci-archive-evidence.json"

echo "[hosted-oci-archive] Prepared checked OCI layout ZIP at sha256:$archive_digest" >&2
