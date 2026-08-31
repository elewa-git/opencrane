"""Provide the runtime's outbound bearer-authenticated JSON transport."""

import json
import threading
import time
from collections.abc import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..constants import MAX_FRAME_BYTES


def post_json(url: str, token: str, body: dict[str, object], timeout: float) -> int:
    """POST one JSON document with the projected workload token.

    The token exists only in the request header and is never logged or copied into the body. urllib
    raises ``HTTPError`` for non-success responses, allowing the caller to apply endpoint-specific
    policy.

    Returns:
        The successful HTTP response status.
    """
    # Materialize one immutable request body before opening the socket. A caller retry must construct
    # its policy around the same logical document rather than streaming a partially encoded mapping.
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    # Do not catch network or HTTP failures here. Bootstrap and candidate admission have different
    # replay rules, so only the endpoint owner has enough context to classify an ambiguous outcome.
    with urlopen(request, timeout=timeout) as response:
        return response.status


def post_candidate(
    control_plane_url: str,
    token: str,
    candidate: dict[str, object],
    send_json: Callable[[str, str, dict[str, object], float], int] = post_json,
) -> None:
    """Deliver one candidate exactly once; the server's durable admission path owns any retry.

    A transport error is ambiguous, so the runtime never repeats an external-action candidate.
    """
    # ``candidate`` already carries its stable id and authority coordinates. This function performs
    # exactly one attempt and never generates a replacement identity after a timeout or refusal.
    status = send_json(
        f"{control_plane_url.rstrip('/')}/candidates",
        token,
        candidate,
        30,
    )
    # Injected transports may return a non-success status rather than raising ``HTTPError``. Preserve
    # explicit refusal as a hard failure so upstream code cannot confuse it with ambiguous loss.
    if not 200 <= status < 300:
        raise RuntimeError(f"candidate admission returned unexpected status {status}")


def post_continuation(
    control_plane_url: str,
    token: str,
    coordinates: dict[str, object],
    input_generation: int,
    continuation: dict[str, object],
    send_json: Callable[[str, str, dict[str, object], float], int] = post_json,
    cancel_event: threading.Event | None = None,
    wait: Callable[[float], bool] | None = None,
) -> None:
    """Save one size-limited plaintext continuation through the private control-plane endpoint.

    The control plane encrypts before persistence. An exact revision and digest are idempotent, so
    an ambiguous network failure or server error retries this same document until cancellation.
    Refusals remain final, and cancellation stops backoff before another request is sent.
    """
    body = {
        "protocolVersion": coordinates["protocolVersion"],
        "runtimeInstanceId": coordinates["runtimeInstanceId"],
        "commandId": coordinates["commandId"],
        "runId": coordinates["runId"],
        "attempt": coordinates["attempt"],
        "fence": coordinates["fence"],
        "inputGeneration": input_generation,
        "continuation": continuation,
    }
    encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_FRAME_BYTES:
        raise RuntimeError("continuation request exceeds the 64KiB boundary")
    destination = f"{control_plane_url.rstrip('/')}/continuations"
    wait_for_retry = wait or (cancel_event.wait if cancel_event is not None else _sleep_for_retry)
    attempt = 0
    while True:
        try:
            status = send_json(destination, token, body, 30)
        except HTTPError as error:
            if error.code < 500:
                raise
        except (URLError, OSError):
            pass
        else:
            if status == 202:
                return
            if status < 500:
                raise RuntimeError(f"continuation admission returned unexpected status {status}")
        if wait_for_retry(min(5.0, 0.25 * (2 ** min(attempt, 5)))):
            raise RuntimeError("continuation admission cancelled during retry")
        attempt += 1


def _sleep_for_retry(delay_seconds: float) -> bool:
    """Sleep between continuation retries and report that no cancellation occurred."""
    time.sleep(delay_seconds)
    return False
