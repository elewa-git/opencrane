"""Provide the runtime's outbound JSON transport with narrowly-scoped retry semantics.

Bootstrap and candidate delivery share bearer-authenticated JSON POSTs, but only one failure shape is
retried here: the control plane's explicit pre-reservation candidate response. Ordinary HTTP,
network, parsing, and denial failures propagate to their owning lifecycle instead of being hidden by
a general-purpose HTTP retry policy.
"""

import json
import threading
from collections.abc import Callable
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ..constants import MAX_CANDIDATE_RETRY_DELAY_SECONDS
from ..observability import log


def post_json(url: str, token: str, body: dict[str, object], timeout: float) -> int:
    """POST one JSON document with the projected workload token.

    The token exists only in the request header and is never logged or copied into the body. urllib
    raises ``HTTPError`` for non-success responses, allowing the caller to apply endpoint-specific
    policy.

    Returns:
        The successful HTTP response status.
    """
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
    with urlopen(request, timeout=timeout) as response:
        return response.status


def retryable_candidate_delay(error: HTTPError) -> float | None:
    """Validate and return the server-selected candidate retry delay.

    A response is retryable only when all of these agree: status 503, ``accepted`` is false,
    ``retryable`` is true, and the delay is a positive integer within the local ceiling. Any malformed
    or different response returns ``None`` and follows the ordinary failure path.
    """
    if error.code != 503:
        return None
    try:
        payload = json.loads(error.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    finally:
        # urllib error responses own a file-like body; always close it after the one bounded read.
        error.close()
    if (
        not isinstance(payload, dict)
        or payload.get("accepted") is not False
        or payload.get("retryable") is not True
    ):
        return None
    delay_milliseconds = payload.get("retryAfterMilliseconds")
    maximum_milliseconds = int(MAX_CANDIDATE_RETRY_DELAY_SECONDS * 1_000)
    if (
        not isinstance(delay_milliseconds, int)
        or delay_milliseconds < 1
        or delay_milliseconds > maximum_milliseconds
    ):
        return None
    return delay_milliseconds / 1_000


def post_candidate_with_retry(
    control_plane_url: str,
    token: str,
    candidate: dict[str, object],
    cancelled: threading.Event,
    send_json: Callable[[str, str, dict[str, object], float], int] = post_json,
) -> None:
    """Deliver one stable candidate across explicit pre-reservation retries.

    The same dictionary, including ``candidateId``, is reused on every attempt. This function never
    creates a replacement candidate and never retries an ambiguous transport failure. Cancellation
    interrupts the server-selected wait and suppresses further delivery.
    """
    while not cancelled.is_set():
        try:
            status = send_json(
                f"{control_plane_url.rstrip('/')}/candidates",
                token,
                candidate,
                30,
            )
            if 200 <= status < 300:
                return
            # Test seams may return a status instead of raising HTTPError. Treat every non-success as
            # unexpected unless it arrived through the validated retryable-error path below.
            raise RuntimeError(f"candidate admission returned unexpected status {status}")
        except HTTPError as error:
            delay_seconds = retryable_candidate_delay(error)
            if delay_seconds is None:
                raise
            log(
                "candidate_retry",
                runId=candidate.get("runId"),
                attempt=candidate.get("attempt"),
                candidateId=candidate.get("candidateId"),
                retry_in_seconds=delay_seconds,
            )
            # Event.wait is both the bounded delay and the prompt cancellation wake-up.
            cancelled.wait(delay_seconds)
