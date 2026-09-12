"""Verify explicit candidate repairs without replacing upstream source evidence."""

import hashlib
import json
import re
from pathlib import Path
from typing import Any


_REPAIR_ROOT = Path("/opt/opencrane/cognee-repair")
_REPAIRED_SOURCE_SCOPE = "official-tag-source-with-explicit-candidate-repair"
_REPAIR_FIELDS = {
    "baseImageDigest", "preimageSha256", "patchSha256", "postimageSha256",
    "patchPath", "receiptPath",
}


def validated_repairs(
    expected: dict[str, Any], profile: dict[str, Any] | None
) -> dict[str, dict[str, str | None]]:
    """Preserve upstream hashes and require explicit absence for newly added modules."""
    repairs = expected.get("repairs", {})
    if not isinstance(repairs, dict):
        raise AssertionError("Candidate repairs must be keyed by module name")
    if not repairs:
        return {}
    if profile is None:
        raise AssertionError("Candidate repairs require the verified image profile")
    source = expected.get("source")
    if not isinstance(source, dict) or source.get("scope") != _REPAIRED_SOURCE_SCOPE:
        raise AssertionError("Repaired source must declare the admitted candidate repair scope")
    base_digest = profile.get("image", {}).get("linuxAmd64Digest")
    if not isinstance(base_digest, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", base_digest) is None:
        raise AssertionError("Candidate profile has no immutable base image digest")
    modules = expected.get("modules", {})
    if not isinstance(modules, dict):
        raise AssertionError("Upstream module evidence must be keyed by module name")
    for module, repair in repairs.items():
        if not isinstance(repair, dict) or set(repair) != _REPAIR_FIELDS:
            raise AssertionError("Candidate repair has missing or unexpected evidence fields")
        if repair["baseImageDigest"] != base_digest:
            raise AssertionError("Candidate repair base differs from the image profile")
        for field in ("patchSha256", "postimageSha256"):
            if not isinstance(repair[field], str) or re.fullmatch(r"[0-9a-f]{64}", repair[field]) is None:
                raise AssertionError("Candidate repair has an invalid source or patch digest")
        preimage = repair["preimageSha256"]
        if module in modules:
            if not isinstance(preimage, str) or re.fullmatch(r"[0-9a-f]{64}", preimage) is None or preimage != modules[module]:
                raise AssertionError("Candidate repair replaced its upstream preimage evidence")
        elif preimage is not None:
            raise AssertionError("A new candidate module must declare an absent preimage")
        if not all(isinstance(repair[field], str) for field in ("patchPath", "receiptPath")):
            raise AssertionError("Candidate repair artifact paths must be strings")
    return repairs


def _repair_file(value: str) -> Path:
    """Accept only a regular, non-symlink artifact inside the fixed image repair directory."""
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise AssertionError("Candidate repair artifact is not a regular absolute file")
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(_REPAIR_ROOT.resolve(strict=True))
    except ValueError as error:
        raise AssertionError("Candidate repair artifact escaped its image directory") from error
    return resolved


def verify_repair(
    module: str, origin: Path, source_digest: str, repair: dict[str, Any]
) -> dict[str, Any]:
    """Bind the loaded module bytes to the retained build receipt and patch artifact."""
    if origin.is_symlink() or not origin.is_file():
        raise AssertionError("Repaired module origin is not a regular non-symlink file")
    patch = _repair_file(repair["patchPath"])
    receipt_path = _repair_file(repair["receiptPath"])
    if patch.samefile(receipt_path) or patch.samefile(origin) or receipt_path.samefile(origin):
        raise AssertionError("Repair patch, receipt and module must be distinct files")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt != {"module": module, **repair}:
        raise AssertionError("Candidate repair receipt differs from its declared build evidence")
    patch_digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    if patch_digest != repair["patchSha256"]:
        raise AssertionError("Candidate repair patch digest differs from the build evidence")
    if source_digest != repair["postimageSha256"]:
        raise AssertionError("Repaired runtime module differs from its declared postimage")
    return {
        "module": module, **repair,
        "actualPatchSha256": patch_digest, "actualPostimageSha256": source_digest,
        "verified": True,
    }
