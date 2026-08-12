"""Provide the runtime's outbound bearer-authenticated JSON transport."""

import json
from collections.abc import Callable
from urllib.request import Request, urlopen


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


def post_candidate(
    control_plane_url: str,
    token: str,
    candidate: dict[str, object],
    send_json: Callable[[str, str, dict[str, object], float], int] = post_json,
) -> None:
    """Deliver one candidate once; durable server admission owns preparation retries.

    A transport error is ambiguous, so the runtime never repeats an external-action candidate.
    """
    status = send_json(
        f"{control_plane_url.rstrip('/')}/candidates",
        token,
        candidate,
        30,
    )
    if not 200 <= status < 300:
        raise RuntimeError(f"candidate admission returned unexpected status {status}")
