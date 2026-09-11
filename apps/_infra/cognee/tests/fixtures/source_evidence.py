#!/usr/bin/env python3
"""Verify the Cognee package and consequential provider modules inside the tested image."""

import argparse
import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import cognee


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def _module_path(module_name: str) -> Path:
    spec = importlib.util.find_spec(module_name)
    if spec is None or spec.origin is None:
        raise AssertionError(f"Cognee module is unavailable: {module_name}")
    return Path(spec.origin)


def main() -> None:
    args = _arguments()
    expected = json.loads(Path(args.expected).read_text(encoding="utf-8"))
    actual_version = getattr(cognee, "__version__", None)
    mismatches = []
    if actual_version != expected["version"]:
        mismatches.append(
            f"Cognee version differs: expected {expected['version']}, received {actual_version}"
        )

    snapshot_directory = Path(args.output).parent / "source-modules"
    if snapshot_directory.exists():
        shutil.rmtree(snapshot_directory)
    snapshot_directory.mkdir()
    modules = {}
    for module_name, expected_digest in expected["modules"].items():
        try:
            path = _module_path(module_name)
        except (AssertionError, ImportError, ValueError) as error:
            modules[module_name] = {"error": str(error)}
            mismatches.append(f"Cognee module is unavailable: {module_name}: {error}")
            continue
        source = path.read_bytes()
        actual_digest = hashlib.sha256(source).hexdigest()
        snapshot = snapshot_directory / f"{module_name}.py"
        snapshot.write_bytes(source)
        if actual_digest != expected_digest:
            mismatches.append(
                f"Cognee source differs for {module_name}: "
                f"expected {expected_digest}, received {actual_digest}"
            )
        modules[module_name] = {
            "path": str(path), "sha256": actual_digest, "snapshot": snapshot.name
        }

    evidence = {
        "cogneeVersion": actual_version,
        "modules": modules,
        "mismatches": mismatches,
    }
    Path(args.output).write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"EVIDENCE cognee_version={actual_version}")
    for module_name, value in modules.items():
        print(f"EVIDENCE module={module_name} sha256={value.get('sha256', 'unavailable')}")
    if mismatches:
        raise AssertionError("\n".join(mismatches))
    print("CASE source_module_attestation PASS")


if __name__ == "__main__":
    main()
