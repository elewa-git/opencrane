#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <local-image-reference> <output-directory>" >&2
  exit 2
fi

image="$1"
output_dir="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile_path="${script_dir}/profile.json"
inspect_path="${output_dir}/image-smoke-inspect.json"
log_path="${output_dir}/image-smoke.log"
receipt_path="${output_dir}/image-smoke-receipt.json"
runtime_output_path="${output_dir}/image-smoke-runtime.jsonl"

mkdir -p "$output_dir"
: > "$log_path"

write_receipt() {
  local outcome="$1"
  local stage="$2"
  local status="$3"

  python3 - "$receipt_path" "$outcome" "$stage" "$status" <<'PY'
import json
import pathlib
import sys

receipt_path, outcome, stage, status = sys.argv[1:]
pathlib.Path(receipt_path).write_text(
    json.dumps(
        {
            "outcome": outcome,
            "stage": stage,
            "exitStatus": int(status),
        },
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY
}

set +e
docker image inspect "$image" > "$inspect_path" 2>> "$log_path"
status="$?"
set -e
if [[ "$status" -ne 0 ]]; then
  write_receipt "fail" "inspect" "$status"
  exit "$status"
fi

set +e
python3 - "$profile_path" "$inspect_path" >> "$log_path" 2>&1 <<'PY'
import json
import pathlib
import sys

profile = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
inspection = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
if len(inspection) != 1:
    raise AssertionError(f"expected one image inspection, found {len(inspection)}")

config = inspection[0]["Config"]
image = profile["image"]
ladybug = profile["ladybug"]
expected_labels = {
    "ai.opencrane.cognee.source-commit": profile["source"]["commit"],
    "ai.opencrane.cognee.base-index-digest": image["indexDigest"],
    "ai.opencrane.cognee.base-linux-amd64-digest": image["linuxAmd64Digest"],
    "ai.opencrane.ladybug-json.sha256": ladybug["extensionSha256"],
}
actual_labels = config.get("Labels") or {}
for name, expected in expected_labels.items():
    if actual_labels.get(name) != expected:
        raise AssertionError(f"image label {name} does not match the candidate profile")

if config.get("User") != image["runtimeUser"]:
    raise AssertionError("image runtime user does not match the candidate profile")
if config.get("WorkingDir") != image["workingDirectory"]:
    raise AssertionError("image working directory does not match the candidate profile")
if config.get("Entrypoint") != image["entrypoint"]:
    raise AssertionError("image entrypoint does not match the candidate profile")

environment = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
expected_environment = {
    "HOME": image["home"],
    "SYSTEM_ROOT_DIRECTORY": image["systemRootDirectory"],
    "DATA_ROOT_DIRECTORY": image["dataRootDirectory"],
}
for name, expected in expected_environment.items():
    if environment.get(name) != expected:
        raise AssertionError(f"image environment {name} does not match the candidate profile")
PY
status="$?"
set -e
if [[ "$status" -ne 0 ]]; then
  write_receipt "fail" "inspect-contract" "$status"
  exit "$status"
fi

set +e
docker run --rm \
  -i \
  --network none \
  --platform linux/amd64 \
  --mount "type=bind,source=${profile_path},target=/tmp/opencrane-candidate-profile.json,readonly" \
  --entrypoint python \
  "$image" \
  - <<'PY' > "$runtime_output_path" 2>&1
import hashlib
import importlib.metadata
import json
import os
import pathlib
import platform
import pwd
import struct
import tempfile

import cognee
import ladybug
from cognee_db_workers.ladybug_migrate import read_ladybug_storage_version


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


profile = json.loads(
    pathlib.Path("/tmp/opencrane-candidate-profile.json").read_text(encoding="utf-8")
)
image = profile["image"]
ladybug_profile = profile["ladybug"]

require(
    cognee.__version__ == profile["source"]["runtimeVersion"],
    "Cognee runtime version does not match the profile",
)
require(platform.machine().lower() in {"amd64", "x86_64"}, "runtime is not AMD64")
require(os.getuid() == image["runtimeUid"], "runtime UID does not match the profile")
require(os.getgid() == image["runtimeGid"], "runtime GID does not match the profile")
require(
    pwd.getpwuid(os.getuid()).pw_name == image["runtimeUser"],
    "runtime user does not match the profile",
)
require(os.environ.get("HOME") == image["home"], "HOME does not match the profile")
require(
    os.environ.get("SYSTEM_ROOT_DIRECTORY") == image["systemRootDirectory"],
    "SYSTEM_ROOT_DIRECTORY does not match the profile",
)
require(
    os.environ.get("DATA_ROOT_DIRECTORY") == image["dataRootDirectory"],
    "DATA_ROOT_DIRECTORY does not match the profile",
)

for root_name in ("systemRootDirectory", "dataRootDirectory"):
    root = pathlib.Path(image[root_name])
    require(root.is_dir(), f"{root_name} is not a directory")
    with tempfile.NamedTemporaryFile(dir=root):
        pass

require(
    importlib.metadata.version("ladybug") == ladybug_profile["packageVersion"],
    "Ladybug package version does not match the profile",
)
extension = pathlib.Path(ladybug_profile["extensionPath"])
require(extension.is_file(), "Ladybug JSON extension is missing")
require(not extension.is_symlink(), "Ladybug JSON extension must be a regular file")
require(
    extension.stat().st_size == ladybug_profile["extensionSizeBytes"],
    "Ladybug JSON extension size does not match the profile",
)
require(
    hashlib.sha256(extension.read_bytes()).hexdigest()
    == ladybug_profile["extensionSha256"],
    "Ladybug JSON extension digest does not match the profile",
)

with tempfile.TemporaryDirectory() as temporary_directory:
    database_path = pathlib.Path(temporary_directory) / "json-smoke"
    database = ladybug.Database(str(database_path))
    connection = None
    try:
        database.init_database()
        connection = ladybug.Connection(database)
        connection.execute("LOAD EXTENSION JSON;")
        connection.execute(
            "CREATE NODE TABLE CandidateSmoke(id INT64 PRIMARY KEY, payload JSON);"
        )
        connection.execute(
            "CREATE (n:CandidateSmoke {id: 1, "
            "payload: cast('{\"values\":[1,2,3]}' AS JSON)});"
        )
    finally:
        if connection is not None:
            connection.close()
        database.close()

    catalog_path = database_path / "catalog.kz" if database_path.is_dir() else database_path
    with catalog_path.open("rb") as catalog:
        catalog.seek(4)
        storage_code_bytes = catalog.read(8)
    require(len(storage_code_bytes) == 8, "Ladybug catalog has no storage code")
    storage_code = struct.unpack("<Q", storage_code_bytes)[0]
    require(
        storage_code == ladybug_profile["storageCode"],
        "Ladybug storage code does not match the profile",
    )
    storage_version = read_ladybug_storage_version(str(database_path))
    require(
        storage_version == ladybug_profile["packageVersion"],
        "Ladybug storage version does not match the profile",
    )

    reopened_database = ladybug.Database(str(database_path))
    reopened_connection = None
    try:
        reopened_database.init_database()
        reopened_connection = ladybug.Connection(reopened_database)
        reopened_connection.execute("LOAD EXTENSION JSON;")
        result = reopened_connection.execute(
            "MATCH (n:CandidateSmoke {id: 1}) "
            "RETURN json_array_length(json_extract(n.payload, 'values')) AS length;"
        )
        require(result.has_next(), "reopened Ladybug database returned no stored row")
        persisted_length = result.get_next()[0]
        require(persisted_length == 3, "reopened Ladybug JSON value is incorrect")
    finally:
        if reopened_connection is not None:
            reopened_connection.close()
        reopened_database.close()

print(
    json.dumps(
        {
            "kind": "cognee_1_5_4_image_smoke",
            "outcome": "pass",
            "cogneeRuntimeVersion": cognee.__version__,
            "runtimeUser": pwd.getpwuid(os.getuid()).pw_name,
            "ladybugPackageVersion": importlib.metadata.version("ladybug"),
            "ladybugStorageCode": storage_code,
            "ladybugStorageVersion": storage_version,
            "persistedJsonArrayLength": persisted_length,
        },
        sort_keys=True,
    )
)
PY
status="$?"
set -e
cat "$runtime_output_path" >> "$log_path"
if [[ "$status" -ne 0 ]]; then
  write_receipt "fail" "runtime" "$status"
  exit "$status"
fi

set +e
python3 - "$runtime_output_path" "$profile_path" >> "$log_path" 2>&1 <<'PY'
import json
import pathlib
import sys

runtime_path, profile_path = map(pathlib.Path, sys.argv[1:])
profile = json.loads(profile_path.read_text(encoding="utf-8"))
markers = []
for line in runtime_path.read_text(encoding="utf-8").splitlines():
    try:
        value = json.loads(line)
    except json.JSONDecodeError:
        continue
    if isinstance(value, dict) and value.get("kind") == "cognee_1_5_4_image_smoke":
        markers.append(value)

if len(markers) != 1:
    raise AssertionError(f"expected one runtime evidence marker, found {len(markers)}")

marker = markers[0]
expected = {
    "outcome": "pass",
    "cogneeRuntimeVersion": profile["source"]["runtimeVersion"],
    "runtimeUser": profile["image"]["runtimeUser"],
    "ladybugPackageVersion": profile["ladybug"]["packageVersion"],
    "ladybugStorageCode": profile["ladybug"]["storageCode"],
    "ladybugStorageVersion": profile["ladybug"]["packageVersion"],
    "persistedJsonArrayLength": 3,
}
for name, expected_value in expected.items():
    if marker.get(name) != expected_value:
        raise AssertionError(f"runtime evidence {name} does not match the profile")
PY
status="$?"
set -e
if [[ "$status" -ne 0 ]]; then
  write_receipt "fail" "runtime-evidence" "$status"
  exit "$status"
fi

write_receipt "pass" "complete" 0
