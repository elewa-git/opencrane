"""Checks the shape of tool results the server saved, before they reach the model.

A ``resume_attempt`` command carries results the server has already produced and stored. The runtime
never calls an external tool while handling them; it only decides whether each result looks like
something the server could have written, and turns it into what the model framework expects.
"""

def validate_tool_results(tool_results: list[object]) -> tuple[list[str], dict[str, object]] | None:
    """Check every saved tool result and convert it into what the model framework takes.

    This function reads no registry and removes nothing, so calling it has no effect you have to undo.
    Its caller checks the participant answers in the same command before removing anything, which is
    what lets a command the server sends twice be handled the same way the second time.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Returns:
        A pair. First the invocation ids in the order they arrived, which the caller uses to find the
        matching pending calls. Second a mapping from invocation id to the value the model will see.
        ``None`` when any result in the batch is unusable; the batch is then rejected whole, because a
        partly accepted batch would leave the model waiting on a call the server thinks is answered.
    """
    validated: dict[str, object] = {}
    identifiers: list[str] = []
    for entry in tool_results:
        if not isinstance(entry, dict) or not isinstance(entry.get("toolInvocationId"), str):
            return None
        identifier = entry["toolInvocationId"]
        # The same invocation id twice does not say which result wins; the later one would quietly
        # replace the earlier.
        if identifier in validated:
            return None
        # A success has to carry a "result" member, even when its value is null. A missing member is
        # not read as an empty success, because the server writes the result and this runtime does not
        # get to invent one.
        if entry.get("outcome") == "succeeded" and set(entry) == {"toolInvocationId", "outcome", "result"}:
            validated[identifier] = entry["result"]
        # For a failure the model sees the failure code and nothing else. Messages from the provider
        # can carry URLs, credentials, or request content, so they stop at the server.
        elif entry.get("outcome") == "failed" and set(entry) == {"toolInvocationId", "outcome", "failureCode"} and isinstance(entry.get("failureCode"), str) and entry["failureCode"]:
            validated[identifier] = {"error": entry["failureCode"]}
        else:
            return None
        identifiers.append(identifier)
    return identifiers, validated
