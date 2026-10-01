#!/usr/bin/env python3
"""Apply one preimage-bound unified source patch without external build tools."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path


_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _apply_unified_patch(source: str, patch: str) -> str:
    source_lines = source.splitlines(keepends=True)
    patch_lines = patch.splitlines(keepends=True)
    output: list[str] = []
    source_index = 0
    patch_index = 0
    while patch_index < len(patch_lines) and not patch_lines[patch_index].startswith("@@ "):
        patch_index += 1

    while patch_index < len(patch_lines):
        match = _HUNK.match(patch_lines[patch_index])
        if match is None:
            raise ValueError("Patch contains an invalid hunk header")
        target_index = max(int(match.group(1)) - 1, 0)
        if target_index < source_index:
            raise ValueError("Patch hunks overlap or are out of order")
        output.extend(source_lines[source_index:target_index])
        source_index = target_index
        patch_index += 1

        while patch_index < len(patch_lines) and not patch_lines[patch_index].startswith("@@ "):
            line = patch_lines[patch_index]
            if line.startswith("\\ No newline at end of file"):
                patch_index += 1
                continue
            if not line or line[0] not in " +-":
                raise ValueError("Patch contains an unsupported line")
            content = line[1:]
            if line[0] in " -":
                if source_index >= len(source_lines) or source_lines[source_index] != content:
                    raise ValueError("Patch context does not match the source")
                source_index += 1
            if line[0] in " +":
                output.append(content)
            patch_index += 1

    output.extend(source_lines[source_index:])
    return "".join(output)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--patch", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--module", required=True)
    parser.add_argument("--base-image-digest", required=True)
    preimage = parser.add_mutually_exclusive_group(required=True)
    preimage.add_argument("--preimage-sha256")
    preimage.add_argument("--preimage-absent", action="store_true")
    parser.add_argument("--patch-sha256", required=True)
    parser.add_argument("--postimage-sha256", required=True)
    return parser.parse_args()


def main() -> None:
    args = _arguments()
    source_path = Path(args.source)
    patch_path = Path(args.patch)
    receipt_path = Path(args.receipt)
    if patch_path.is_symlink() or not patch_path.is_file():
        raise AssertionError("Repair patch must be a regular non-symlink file")

    source_stat = None
    if args.preimage_absent:
        if source_path.exists() or source_path.is_symlink():
            raise AssertionError("Cognee repair source addition already exists")
        source_bytes = b""
    else:
        if source_path.is_symlink() or not source_path.is_file():
            raise AssertionError("Repair source must be a regular non-symlink file")
        source_bytes = source_path.read_bytes()
        source_stat = source_path.stat()
    patch_bytes = patch_path.read_bytes()
    if not args.preimage_absent and _sha256(source_bytes) != args.preimage_sha256:
        raise AssertionError("Cognee repair source preimage differs")
    if _sha256(patch_bytes) != args.patch_sha256:
        raise AssertionError("Cognee repair patch differs")

    patched = _apply_unified_patch(
        source_bytes.decode("utf-8"), patch_bytes.decode("utf-8")
    ).encode("utf-8")
    if _sha256(patched) != args.postimage_sha256:
        raise AssertionError("Cognee repair source postimage differs")

    temporary_path = source_path.with_suffix(source_path.suffix + ".opencrane-repair")
    temporary_path.write_bytes(patched)
    if source_stat is None:
        os.chmod(temporary_path, 0o644)
    else:
        os.chmod(temporary_path, source_stat.st_mode)
        os.chown(temporary_path, source_stat.st_uid, source_stat.st_gid)
    temporary_path.replace(source_path)
    receipt = {
        "module": args.module,
        "baseImageDigest": args.base_image_digest,
        "preimageSha256": None if args.preimage_absent else args.preimage_sha256,
        "patchSha256": args.patch_sha256,
        "postimageSha256": args.postimage_sha256,
        "patchPath": str(patch_path),
        "receiptPath": str(receipt_path),
    }
    receipt_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
