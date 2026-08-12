"""Map saved control-plane tool results into the model loop.

A ``resume_attempt`` carries only server-owned terminal results. The runtime never calls an
external provider while resolving them. Each result must still match a pending tool call from the
same run attempt before it can enter model context.
"""

def validate_tool_results(tool_results: list[object]) -> tuple[list[str], dict[str, object]] | None:
    """Validate exact saved tool-result shapes without reading or consuming pending calls."""
    validated: dict[str, object] = {}
    identifiers: list[str] = []
    for entry in tool_results:
        if not isinstance(entry, dict) or not isinstance(entry.get("toolInvocationId"), str):
            return None
        identifier = entry["toolInvocationId"]
        if identifier in validated:
            return None
        if entry.get("outcome") == "succeeded" and set(entry) == {"toolInvocationId", "outcome", "result"}:
            validated[identifier] = entry["result"]
        elif entry.get("outcome") == "failed" and set(entry) == {"toolInvocationId", "outcome", "failureCode"} and isinstance(entry.get("failureCode"), str) and entry["failureCode"]:
            validated[identifier] = {"error": entry["failureCode"]}
        else:
            return None
        identifiers.append(identifier)
    return identifiers, validated
