#!/usr/bin/env python3
"""Verify the Cognee package and consequential provider modules inside the tested image."""

import argparse
import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import cognee

from source_repair_evidence import validated_repairs, verify_repair


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", required=True)
    parser.add_argument("--profile")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def _module_path(module_name: str) -> Path:
    spec = importlib.util.find_spec(module_name)
    if spec is None or spec.origin is None:
        raise AssertionError(f"Cognee module is unavailable: {module_name}")
    return Path(spec.origin)


def _write_evidence(output: str, evidence: dict) -> None:
    """Retain the same diagnostic receipt on success and declaration failure."""
    Path(output).write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> None:
    args = _arguments()
    expected = json.loads(Path(args.expected).read_text(encoding="utf-8"))
    profile = json.loads(Path(args.profile).read_text(encoding="utf-8")) if args.profile else None
    actual_version = getattr(cognee, "__version__", None)
    mismatches = []
    modules = {}
    repair_evidence = {}
    profile_image = profile.get("image") if isinstance(profile, dict) else None
    evidence = {
        "cogneeVersion": actual_version,
        "modules": modules,
        "repairs": repair_evidence,
        "declaredRepairs": expected.get("repairs", {}),
        "profileBaseImageDigest": profile_image.get("linuxAmd64Digest")
        if isinstance(profile_image, dict) else None,
        "mismatches": mismatches,
    }
    try:
        repairs = validated_repairs(expected, profile)
    except (AssertionError, AttributeError, TypeError, ValueError) as error:
        mismatches.append(f"Candidate repair declaration is invalid: {error}")
        _write_evidence(args.output, evidence)
        raise AssertionError(mismatches[0]) from error
    if actual_version != expected["version"]:
        mismatches.append(
            f"Cognee version differs: expected {expected['version']}, received {actual_version}"
        )

    snapshot_directory = Path(args.output).parent / "source-modules"
    if snapshot_directory.exists():
        shutil.rmtree(snapshot_directory)
    snapshot_directory.mkdir()
    module_names = dict.fromkeys([*expected["modules"], *repairs])
    for module_name in module_names:
        expected_digest = expected["modules"].get(module_name)
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
        if module_name in repairs:
            try:
                repair_evidence[module_name] = verify_repair(
                    module_name, path, actual_digest, repairs[module_name]
                )
            except (AssertionError, OSError, ValueError) as error:
                mismatches.append(f"Candidate repair verification failed for {module_name}: {error}")
        elif actual_digest != expected_digest:
            mismatches.append(
                f"Cognee source differs for {module_name}: "
                f"expected {expected_digest}, received {actual_digest}"
            )
        modules[module_name] = {
            "path": str(path), "sha256": actual_digest, "snapshot": snapshot.name
        }

    unverified_repairs = set(repairs) - set(repair_evidence)
    if unverified_repairs:
        mismatches.append("Candidate repairs were not verified: " + ", ".join(sorted(unverified_repairs)))

    _write_evidence(args.output, evidence)
    print(f"EVIDENCE cognee_version={actual_version}")
    for module_name, value in modules.items():
        print(f"EVIDENCE module={module_name} sha256={value.get('sha256', 'unavailable')}")
    if mismatches:
        raise AssertionError("\n".join(mismatches))
    print("CASE source_module_attestation PASS")


if __name__ == "__main__":
    main()
