"""Keep one bounded, serializable continuation for each active attempt.

The process keeps only a working copy. Before an attempt waits, ``execution.py`` sends an exact
snapshot to the control plane, which encrypts and stores the durable copy. A replacement runtime
receives that copy only inside a fenced resume command and restores it here before consuming any
saved result.
"""

import copy
import threading
from dataclasses import dataclass, field

from .continuation_codec import (
    CONTINUATION_VERSION,
    MAX_PENDING_CORRELATIONS,
    decode_continuation,
    deserialize_model_messages,
    encode_continuation,
    is_counter,
    is_identifier,
    is_json_mapping,
    serialize_model_messages,
)

MAX_ACTIVE_CONTINUATIONS = 256


@dataclass
class AttemptContinuation:
    """Hold the working state that must survive replacement while an attempt waits.

    This in-memory copy is not recovery storage. ``checkpoint_continuation`` sends the state to the
    control plane before the attempt reports that it is waiting.
    """

    run_id: str
    attempt: int
    input_generation: int
    applied_command_sequence: int
    compiled_input: dict[str, object]
    revision: int = 0
    model_messages: list[object] = field(default_factory=list)
    pending_tool_calls: dict[str, str] = field(default_factory=dict)
    pending_elicitations: dict[str, str] = field(default_factory=dict)


_LOCK = threading.RLock()
_CONTINUATIONS: dict[tuple[str, int], AttemptContinuation] = {}


def initialize_continuation(
    run_id: str,
    attempt: int,
    input_generation: int,
    command_sequence: int,
    compiled_input: dict[str, object],
) -> None:
    """Start one fresh attempt continuation before any model work begins.

    Called by: ``execute_start_attempt`` after the command and compiled input pass their fences.
    """
    key = _key(run_id, attempt)
    if not is_counter(input_generation) or not is_counter(command_sequence, allow_zero=False):
        raise RuntimeError("attempt continuation requires exact generations")
    if not is_json_mapping(compiled_input):
        raise RuntimeError("attempt continuation requires JSON compiled input")
    with _LOCK:
        if key not in _CONTINUATIONS and len(_CONTINUATIONS) >= MAX_ACTIVE_CONTINUATIONS:
            raise RuntimeError("attempt continuation capacity exceeded")
        _CONTINUATIONS[key] = AttemptContinuation(
            run_id=run_id,
            attempt=attempt,
            input_generation=input_generation,
            applied_command_sequence=command_sequence,
            compiled_input=copy.deepcopy(compiled_input),
        )


def restore_continuation(
    value: object,
    run_id: str,
    attempt: int,
    input_generation: int,
    resume_command_sequence: int,
) -> None:
    """Restore state from the continuation attached to a server-approved resume command.

    Validation runs before result lookup or model work, so a stale or malformed document cannot
    supply message history or pending-call links to this attempt.

    Raises:
        RuntimeError: When the value is malformed, oversized, stale, foreign, or has the wrong
            digest. The caller fails the command without starting model or provider work.
    """
    document = decode_continuation(value)
    if (
        document["runId"] != run_id
        or document["attempt"] != attempt
        or document["inputGeneration"] != input_generation
        or document["appliedCommandSequence"] >= resume_command_sequence
    ):
        raise RuntimeError("attempt continuation coordinates do not match")
    compiled_input = document["compiledInput"]
    if compiled_input.get("runId") != run_id or compiled_input.get("attempt") != attempt:
        raise RuntimeError("attempt continuation compiled input does not match")
    pending_tools = {
        item["toolInvocationId"]: item["frameworkCallId"]
        for item in document["pendingToolCalls"]
    }
    pending_elicitations = {
        item["requestKey"]: item["frameworkCallId"]
        for item in document["pendingElicitations"]
    }
    if len(pending_tools) != len(document["pendingToolCalls"]) or len(pending_elicitations) != len(document["pendingElicitations"]):
        raise RuntimeError("attempt continuation repeats pending identities")
    restored = AttemptContinuation(
        run_id=run_id,
        attempt=attempt,
        input_generation=input_generation,
        applied_command_sequence=int(document["appliedCommandSequence"]),
        compiled_input=copy.deepcopy(compiled_input),
        revision=int(document["revision"]),
        model_messages=copy.deepcopy(document["modelMessages"]),
        pending_tool_calls=pending_tools,
        pending_elicitations=pending_elicitations,
    )
    with _LOCK:
        key = _key(run_id, attempt)
        if key not in _CONTINUATIONS and len(_CONTINUATIONS) >= MAX_ACTIVE_CONTINUATIONS:
            raise RuntimeError("attempt continuation capacity exceeded")
        _CONTINUATIONS[key] = restored


def continuation_compiled_input(run_id: str, attempt: int) -> dict[str, object] | None:
    """Return the restored compiled input for one exact attempt."""
    with _LOCK:
        continuation = _CONTINUATIONS.get(_key(run_id, attempt))
        return None if continuation is None else copy.deepcopy(continuation.compiled_input)


def store_model_messages(run_id: str, attempt: int, messages: list[object]) -> None:
    """Replace the attempt's compact JSON model history."""
    serialized = serialize_model_messages(messages)
    with _LOCK:
        continuation = _required(run_id, attempt)
        continuation.model_messages = serialized


def load_model_messages(run_id: str, attempt: int) -> list[object] | None:
    """Return framework messages reconstructed from the attempt's JSON history."""
    with _LOCK:
        continuation = _CONTINUATIONS.get(_key(run_id, attempt))
        if continuation is None or not continuation.model_messages:
            return None
        serialized = copy.deepcopy(continuation.model_messages)
    return deserialize_model_messages(serialized)


def record_tool_call(run_id: str, attempt: int, tool_invocation_id: str) -> None:
    """Record the model call identity that a server result must resolve."""
    if not is_identifier(tool_invocation_id):
        raise ValueError("pending tool call requires an identifier")
    with _LOCK:
        continuation = _required(run_id, attempt)
        existing = continuation.pending_tool_calls.get(tool_invocation_id)
        if existing is not None and existing != tool_invocation_id:
            raise ValueError("pending tool call is already bound")
        if existing is None and len(continuation.pending_tool_calls) >= MAX_PENDING_CORRELATIONS:
            raise ValueError("pending tool-call capacity exceeded")
        continuation.pending_tool_calls[tool_invocation_id] = tool_invocation_id


def peek_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> dict[str, dict[str, object]] | None:
    """Find one complete pending tool-result batch while the caller holds the shared lock."""
    continuation = _CONTINUATIONS.get(_key(run_id, attempt))
    if continuation is None or len(tool_invocation_ids) != len(set(tool_invocation_ids)):
        return None
    if any(identifier not in continuation.pending_tool_calls for identifier in tool_invocation_ids):
        return None
    return {identifier: {"frameworkCallId": continuation.pending_tool_calls[identifier]} for identifier in tool_invocation_ids}


def consume_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> None:
    """Remove a pending tool-result batch after its joint validation succeeds."""
    continuation = _required(run_id, attempt)
    for identifier in tool_invocation_ids:
        del continuation.pending_tool_calls[identifier]


def record_elicitation(run_id: str, attempt: int, request_key: str, framework_call_id: str) -> None:
    """Record the exact request-key to framework-call correlation for one question."""
    if not is_identifier(request_key) or not is_identifier(framework_call_id):
        raise ValueError("pending elicitation requires exact identifiers")
    with _LOCK:
        continuation = _required(run_id, attempt)
        existing = continuation.pending_elicitations.get(request_key)
        if existing is not None and existing != framework_call_id:
            raise ValueError("elicitation request key is already bound")
        if existing is None and len(continuation.pending_elicitations) >= MAX_PENDING_CORRELATIONS:
            raise ValueError("pending elicitation capacity exceeded")
        if existing is None and framework_call_id in continuation.pending_elicitations.values():
            raise ValueError("elicitation framework call is already bound")
        continuation.pending_elicitations[request_key] = framework_call_id


def peek_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> list[str] | None:
    """Find one complete pending elicitation batch while the caller holds the shared lock."""
    continuation = _CONTINUATIONS.get(_key(run_id, attempt))
    if continuation is None or len(request_keys) != len(set(request_keys)):
        return None
    if any(identifier not in continuation.pending_elicitations for identifier in request_keys):
        return None
    return [continuation.pending_elicitations[identifier] for identifier in request_keys]


def consume_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> None:
    """Remove pending questions after their joint result validation succeeds."""
    continuation = _required(run_id, attempt)
    for identifier in request_keys:
        del continuation.pending_elicitations[identifier]


def checkpoint_continuation(run_id: str, attempt: int, command_sequence: int, input_generation: int) -> dict[str, object]:
    """Build the next snapshot after every pending call has been sent to the server.

    The caller must save this document before reporting a waiting state. Its revision and applied
    command sequence prevent an older pause from replacing newer resume state.
    """
    with _LOCK:
        continuation = _required(run_id, attempt)
        if continuation.input_generation != input_generation:
            raise RuntimeError("attempt continuation input generation changed")
        if continuation.revision == 0 and command_sequence != continuation.applied_command_sequence:
            raise RuntimeError("initial continuation command sequence changed")
        if continuation.revision > 0 and command_sequence <= continuation.applied_command_sequence:
            raise RuntimeError("attempt continuation command sequence did not advance")
        if not continuation.pending_tool_calls and not continuation.pending_elicitations:
            raise RuntimeError("attempt continuation has no pending call")
        document: dict[str, object] = {
            "version": CONTINUATION_VERSION,
            "revision": continuation.revision + 1,
            "runId": continuation.run_id,
            "attempt": continuation.attempt,
            "inputGeneration": continuation.input_generation,
            "appliedCommandSequence": command_sequence,
            "compiledInput": copy.deepcopy(continuation.compiled_input),
            "modelMessages": copy.deepcopy(continuation.model_messages),
            "pendingToolCalls": [
                {"toolInvocationId": identifier, "frameworkCallId": framework_call_id}
                for identifier, framework_call_id in sorted(continuation.pending_tool_calls.items())
            ],
            "pendingElicitations": [
                {"requestKey": request_key, "frameworkCallId": framework_call_id}
                for request_key, framework_call_id in sorted(continuation.pending_elicitations.items())
            ],
        }
        document = encode_continuation(document)
        continuation.revision += 1
        continuation.applied_command_sequence = command_sequence
        return document


def clear_continuation(run_id: str, attempt: int) -> None:
    """Forget the working copy after terminal state or cancellation."""
    with _LOCK:
        _CONTINUATIONS.pop(_key(run_id, attempt), None)


def continuation_lock() -> threading.RLock:
    """Return the shared lock used for atomic mixed-result validation and consumption."""
    return _LOCK


def _required(run_id: str, attempt: int) -> AttemptContinuation:
    """Return the aggregate for exact coordinates or fail closed."""
    continuation = _CONTINUATIONS.get(_key(run_id, attempt))
    if continuation is None:
        raise RuntimeError("attempt continuation is unavailable")
    return continuation


def _key(run_id: str, attempt: int) -> tuple[str, int]:
    """Build one collision-free attempt key."""
    if not is_identifier(run_id) or not is_counter(attempt, allow_zero=False):
        raise RuntimeError("attempt continuation requires exact coordinates")
    return (run_id, attempt)
