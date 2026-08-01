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
    print(json.dumps({"component": "agent-runtime", "event": event, **fields}, sort_keys=True), flush=True)


@contextlib.contextmanager
def trace(operation: str, **attributes: object):
    """Yield an OpenTelemetry span when available, otherwise a transparent ``None`` span.

    The lazy import keeps offline conformance tests and the minimal container independent of a
    mandatory telemetry SDK. Attributes follow the same safe-field contract as :func:`log`.
    Instrumentation failure due solely to an absent SDK therefore cannot change runtime behaviour.
    """
    try:
        from opentelemetry import trace as otel_trace
    except ImportError:
        # Observability is deliberately non-load-bearing for the execution protocol.
        yield None
        return
    tracer = otel_trace.get_tracer("agent-runtime")
    with tracer.start_as_current_span(operation) as span:
        for key, value in attributes.items():
            span.set_attribute(key, value)
        yield span


def run_evidence(coordinates: dict[str, object], outcome: str, **fields: object) -> None:
    """Emit a wide execution record bound to the command that caused the outcome.

    This evidence is useful for operators, but it is not a durable ``RunEvent`` and never replaces
    control-plane persistence. The coordinate projection keeps logs correlatable without copying the
    complete command or its payload.
    """
    log(
        "run_evidence",
        runId=coordinates.get("runId"),
        attempt=coordinates.get("attempt"),
        commandId=coordinates.get("commandId"),
        runtimeInstanceId=coordinates.get("runtimeInstanceId"),
        outcome=outcome,
        **fields,
    )
