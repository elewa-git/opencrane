"""Emit correlation evidence without becoming a second transcript or leaking credentials.

Logs and spans describe control flow using immutable run coordinates and error *types*. Model
content, tool arguments, tokens, keys, bootstrap references, and checkpoint contents do not belong
here. OpenTelemetry is optional so an unavailable instrumentation dependency cannot prevent the
isolated runtime from reporting candidates to the control plane.
"""

import contextlib
import json


def log(event: str, **fields: object) -> None:
    """Emit one newline-delimited JSON record to standard output.

    ``fields`` is intentionally an explicit trust boundary: callers may pass safe identifiers and
    bounded outcomes only. This low-level helper cannot redact arbitrary nested payloads, so callers
    must never provide commands, model content, tool arguments, or credential material.
    """
    # Build exactly one record so collectors cannot confuse continuation lines with separate events.
    # Stable key ordering improves incident diffs without implying event ordering; causal order comes
    # from runtime/run/attempt coordinates supplied by the caller.
    #
    # ``flush=True`` is operationally important in short-lived Jobs: termination may follow a denial
    # or terminal outcome before Python's buffered stdout would otherwise be written.
    print(json.dumps({"component": "agent-runtime", "event": event, **fields}, sort_keys=True), flush=True)


@contextlib.contextmanager
def trace(operation: str, **attributes: object):
    """Yield an OpenTelemetry span when available, otherwise a transparent ``None`` span.

    The lazy import keeps offline conformance tests and the minimal container independent of a
    mandatory telemetry SDK. Attributes follow the same safe-field contract as :func:`log`.
    Instrumentation failure due solely to an absent SDK therefore cannot change runtime behaviour.
    """
    try:
        # Import at span creation rather than module import so telemetry remains optional and cannot
        # prevent bootstrap in the minimal runtime image.
        from opentelemetry import trace as otel_trace
    except ImportError:
        # Observability is deliberately non-load-bearing for the execution protocol.
        yield None
        return
    tracer = otel_trace.get_tracer("agent-runtime")
    with tracer.start_as_current_span(operation) as span:
        # Attributes are attached before yielding so nested work and exceptions are correlated with
        # the admitted coordinates for the entire operation. Callers still own redaction: tracing
        # backends are no safer a destination for content or credentials than logs.
        for key, value in attributes.items():
            span.set_attribute(key, value)
        yield span


def run_evidence(coordinates: dict[str, object], outcome: str, **fields: object) -> None:
    """Emit a wide execution record bound to the command that caused the outcome.

    This evidence is useful for operators, but it is not a durable ``RunEvent`` and never replaces
    control-plane persistence. The coordinate projection keeps logs correlatable without copying the
    complete command or its payload.
    """
    # Project an allowlisted set instead of spreading ``coordinates``. Commands carry additional
    # content and authority evidence that must never be copied wholesale into an operator log.
    # Missing values remain explicit ``null`` fields, which exposes incomplete correlation without
    # fabricating identifiers or making observability a validation authority.
    log(
        "run_evidence",
        runId=coordinates.get("runId"),
        attempt=coordinates.get("attempt"),
        commandId=coordinates.get("commandId"),
        runtimeInstanceId=coordinates.get("runtimeInstanceId"),
        outcome=outcome,
        **fields,
    )
