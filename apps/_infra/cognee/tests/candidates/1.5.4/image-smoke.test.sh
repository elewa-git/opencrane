#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

fake_bin="${temporary_directory}/bin"
output_dir="${temporary_directory}/evidence"
mkdir -p "$fake_bin"

cat > "${fake_bin}/docker" <<'SH'
#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
  cat <<'JSON'
[
  {
    "Config": {
      "User": "cognee",
      "WorkingDir": "/app",
      "Entrypoint": ["/app/entrypoint.sh"],
      "Env": [
        "HOME=/app",
        "SYSTEM_ROOT_DIRECTORY=/cognee-storage/system",
        "DATA_ROOT_DIRECTORY=/cognee-storage/data"
      ],
      "Labels": {
        "ai.opencrane.cognee.source-commit": "20e0bd88746de2d96e99b4b122361dfc3dad21bc",
        "ai.opencrane.cognee.base-index-digest": "sha256:68b755bebae2a19f482069b5efcbe8e4bdf717a68f6afb6fef80c3c352c37015",
        "ai.opencrane.cognee.base-linux-amd64-digest": "sha256:a52b0c2669e28932b53d677a6adf6d6487b03886732a5db07b58f3b869647b10",
        "ai.opencrane.cognee.repair-patch-sha256": "08d46750e34abdc9a0cd76d37318fa886b027ef50bb792b0f25f27f526574b50",
        "ai.opencrane.cognee.repair-postimage-sha256": "3d7f8fdc029226ba33919838a522b0325e616d3c3c7820fde828f90c68c8daaf",
        "ai.opencrane.ladybug-json.sha256": "39c51fa9b1915590a500eef732c76913aeb10cd942e46e1c259497e609b97426"
      }
    }
  }
]
JSON
  exit 0
fi

if [[ "${1:-}" == "run" ]]; then
  interactive=false
  for argument in "$@"; do
    if [[ "$argument" == "-i" ]]; then
      interactive=true
    fi
  done
  if [[ "$interactive" != "true" ]]; then
    exit 65
  fi
  : > "${FAKE_DOCKER_INTERACTIVE_MARKER:?}"
  exit 0
fi

exit 64
SH
chmod +x "${fake_bin}/docker"

set +e
FAKE_DOCKER_INTERACTIVE_MARKER="${temporary_directory}/interactive" \
  PATH="${fake_bin}:${PATH}" \
  "${script_dir}/image-smoke.sh" "opencrane-cognee:test-only" "$output_dir"
status="$?"
set -e

if [[ "$status" -eq 0 ]]; then
  echo "image smoke accepted Docker success without runtime evidence" >&2
  exit 1
fi

if [[ ! -f "${temporary_directory}/interactive" ]]; then
  echo "image smoke did not forward its Python program to Docker stdin" >&2
  exit 1
fi

python3 - "${output_dir}/image-smoke-receipt.json" <<'PY'
import json
import pathlib
import sys

receipt = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = {
    "outcome": "fail",
    "stage": "runtime-evidence",
    "exitStatus": 1,
}
if receipt != expected:
    raise AssertionError(f"unexpected failure receipt: {receipt!r}")
PY

echo "image smoke runtime evidence regression passed"
