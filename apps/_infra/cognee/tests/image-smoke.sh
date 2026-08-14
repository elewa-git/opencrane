#!/usr/bin/env bash
set -euo pipefail

image="opencrane-cognee:smoke"
extension_path="/root/.lbdb/extension/v0.17.0/linux_amd64/json/libjson.lbug_extension"
extension_sha="8a5eb3c6c70cc86ea34aea777e9fc78687f69d1396055d878d2b9e0a79cb5114"

docker build --platform linux/amd64 -t "$image" -f apps/_infra/cognee/deploy/Dockerfile .
docker run --rm --network none --platform linux/amd64 --entrypoint python "$image" -c '
import hashlib
import pathlib
import platform
import tempfile

import ladybug

extension = pathlib.Path("'"$extension_path"'")
assert platform.machine() in {"amd64", "x86_64"}
assert extension.is_file()
assert hashlib.sha256(extension.read_bytes()).hexdigest() == "'"$extension_sha"'"
with tempfile.TemporaryDirectory() as directory:
    database = ladybug.Database(str(pathlib.Path(directory) / "offline-smoke"))
    database.init_database()
    connection = ladybug.Connection(database)
    connection.execute("LOAD EXTENSION JSON;")
    connection.close()
    database.close()
print("Cognee loaded the pinned LadybugDB json extension with networking disabled.")
'
