"""Encode the attempt state that the control plane stores for process replacement."""

import copy
import hashlib
import json
import math
import re

CONTINUATION_VERSION = "opencrane.agent-runtime-continuation/v1"
MAX_PENDING_CORRELATIONS = 128
MAX_IDENTIFIER_CHARACTERS = 256
MAX_SERIALIZED_CONTINUATION_BYTES = 48 * 1_024
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_UNSIGNED_FIELDS = {
    "version",
    "revision",
    "runId",
    "attempt",
    "inputGeneration",
    "appliedCommandSequence",
    "compiledInput",
    "modelMessages",
    "pendingToolCalls",
    "pendingElicitations",
}


def encode_continuation(unsigned: dict[str, object]) -> dict[str, object]:
    """Add the shared JSON digest and return a fully validated continuation document.

    Called by: ``attempts.continuation.checkpoint_continuation`` before the runtime sends a
    checkpoint to the control plane.
    """
    candidate = copy.deepcopy(unsigned)
    candidate["digest"] = digest_continuation(candidate)
    return decode_continuation(candidate)


def decode_continuation(value: object) -> dict[str, object]:
    """Validate an incoming continuation before it replaces the attempt's working state.

    Called by: ``attempts.continuation.restore_continuation`` before it replaces working state.
    """
    if not isinstance(value, dict):
        raise RuntimeError("attempt continuation is malformed or oversized")
    encoded = canonical_bytes(value)
    if len(encoded) > MAX_SERIALIZED_CONTINUATION_BYTES:
        raise RuntimeError("attempt continuation is malformed or oversized")
    if set(value) != _UNSIGNED_FIELDS | {"digest"} or value.get("version") != CONTINUATION_VERSION:
        raise RuntimeError("attempt continuation version or fields are invalid")
    unsigned = {key: item for key, item in value.items() if key != "digest"}
    digest = value.get("digest")
    if not isinstance(digest, str) or _DIGEST.fullmatch(digest) is None or digest != digest_continuation(unsigned):
        raise RuntimeError("attempt continuation digest does not match")
    if not _valid_content(value):
        raise RuntimeError("attempt continuation content is invalid")
    return copy.deepcopy(value)


def digest_continuation(value: dict[str, object]) -> str:
    """Digest the shared RFC 8785 JSON bytes; this detects changes but does not hide content."""
    if set(value) != _UNSIGNED_FIELDS:
        raise RuntimeError("attempt continuation fields are invalid")
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def canonical_bytes(value: object) -> bytes:
    """Encode one JSON value with the server's RFC 8785 canonicalization rules."""
    if not _is_json_value(value):
        raise RuntimeError("attempt continuation is not JSON")
    try:
        import rfc8785

        return rfc8785.dumps(value)
    except ImportError:
        # Framework-free unit tests use only integer numbers and basic-plane keys. For those
        # values, this form produces the same bytes as RFC 8785.
        if _requires_full_canonicalizer(value):
            raise RuntimeError("RFC 8785 canonicalization dependency is unavailable")
        try:
            return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeEncodeError) as error:
            raise RuntimeError("attempt continuation is not canonical JSON") from error
    except (TypeError, ValueError) as error:
        raise RuntimeError("attempt continuation is not JSON") from error


def serialize_model_messages(messages: list[object]) -> list[object]:
    """Convert framework messages to compact JSON values at the wire boundary."""
    try:
        value = json.loads(json.dumps(messages, separators=(",", ":"), allow_nan=False))
    except (TypeError, ValueError):
        from pydantic_ai.messages import ModelMessagesTypeAdapter

        value = json.loads(ModelMessagesTypeAdapter.dump_json(messages))
    if not isinstance(value, list) or not _is_json_value(value):
        raise RuntimeError("model history did not serialize as a JSON list")
    return value


def deserialize_model_messages(messages: list[object]) -> list[object]:
    """Rebuild framework messages while keeping JSON fixtures framework-free in tests."""
    try:
        from pydantic_ai.messages import ModelMessagesTypeAdapter
    except ImportError:
        return copy.deepcopy(messages)
    return list(ModelMessagesTypeAdapter.validate_python(messages))


def is_identifier(value: object) -> bool:
    """Return whether a value is a non-empty bounded wire identifier."""
    return isinstance(value, str) and 0 < len(value) <= MAX_IDENTIFIER_CHARACTERS


def is_counter(value: object, *, allow_zero: bool = True) -> bool:
    """Return whether a value is an integer inside the shared wire range."""
    minimum = 0 if allow_zero else 1
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= _MAX_SAFE_INTEGER


def is_json_mapping(value: object) -> bool:
    """Return whether a mapping contains only strict JSON values."""
    return isinstance(value, dict) and _is_json_value(value)


def _valid_content(value: dict[str, object]) -> bool:
    """Validate scalar fields and both bounded correlation lists."""
    return (
        is_identifier(value.get("runId"))
        and is_counter(value.get("attempt"))
        and is_counter(value.get("inputGeneration"))
        and is_counter(value.get("appliedCommandSequence"))
        and is_counter(value.get("revision"), allow_zero=False)
        and is_json_mapping(value.get("compiledInput"))
        and isinstance(value.get("modelMessages"), list)
        and _is_json_value(value.get("modelMessages"))
        and _valid_pending_tools(value.get("pendingToolCalls"))
        and _valid_pending_elicitations(value.get("pendingElicitations"))
        and bool(value.get("pendingToolCalls") or value.get("pendingElicitations"))
    )


def _valid_pending_tools(value: object) -> bool:
    """Validate unique tool and framework correlations without accepting extra fields."""
    if not isinstance(value, list) or len(value) > MAX_PENDING_CORRELATIONS:
        return False
    tool_ids: set[str] = set()
    framework_ids: set[str] = set()
    for item in value:
        if (
            not isinstance(item, dict)
            or set(item) != {"toolInvocationId", "frameworkCallId"}
            or not is_identifier(item.get("toolInvocationId"))
            or not is_identifier(item.get("frameworkCallId"))
            or item["toolInvocationId"] in tool_ids
            or item["frameworkCallId"] in framework_ids
        ):
            return False
        tool_ids.add(item["toolInvocationId"])
        framework_ids.add(item["frameworkCallId"])
    return True


def _valid_pending_elicitations(value: object) -> bool:
    """Validate unique question correlations and the optional server request coordinate."""
    if not isinstance(value, list) or len(value) > MAX_PENDING_CORRELATIONS:
        return False
    request_keys: set[str] = set()
    framework_ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            return False
        keys = set(item)
        if (
            keys not in ({"requestKey", "frameworkCallId"}, {"requestId", "requestKey", "frameworkCallId"})
            or not is_identifier(item.get("requestKey"))
            or not is_identifier(item.get("frameworkCallId"))
            or ("requestId" in item and not is_identifier(item.get("requestId")))
            or item["requestKey"] in request_keys
            or item["frameworkCallId"] in framework_ids
        ):
            return False
        request_keys.add(item["requestKey"])
        framework_ids.add(item["frameworkCallId"])
    return True


def _is_json_value(value: object) -> bool:
    """Return whether a value uses only lossless cross-language JSON types."""
    if value is None or isinstance(value, (str, bool)):
        return True
    if isinstance(value, int):
        return not isinstance(value, bool) and -_MAX_SAFE_INTEGER <= value <= _MAX_SAFE_INTEGER
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_is_json_value(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _is_json_value(item) for key, item in value.items())
    return False


def _requires_full_canonicalizer(value: object) -> bool:
    """Return whether the standard-library test fallback could differ from RFC 8785."""
    if isinstance(value, float):
        return True
    if isinstance(value, list):
        return any(_requires_full_canonicalizer(item) for item in value)
    if isinstance(value, dict):
        return any(any(ord(character) > 0xFFFF for character in key) or _requires_full_canonicalizer(item) for key, item in value.items())
    return False
