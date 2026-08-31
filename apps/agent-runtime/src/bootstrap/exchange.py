"""Bind public proof-key evidence to one reviewed warm Pod.

Binding runs before the command stream. A client error means the reservation or proof does not match
and is permanent for this process. Transport and server errors stay retryable in ``runtime.py``
because the control plane may not have evaluated the one-use claim.
"""

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ..observability import log


class BootstrapDeniedError(RuntimeError):
    """Signal a permanent binding refusal that must terminate this runtime."""


def perform_warm_binding(
    control_plane_url: str,
    token: str,
    proof_key: dict[str, object],
) -> str:
    """Bind this reviewed warm Pod and return its in-memory attempt model key.

    The request carries no run or assignment coordinate. The server finds the one ready reservation
    from the Pod UID embedded in the reviewed projected token, commits the proof-key binding, and
    only then mints the short-lived key returned here. A successful retry may return a newly minted
    key under the same attempt-stable alias; the runtime keeps only the received value in memory.
    """
    body = {
        "proofPublicJwk": proof_key["publicJwk"],
        "proofKeyThumbprint": proof_key["thumbprint"],
    }
    request = Request(
        f"{control_plane_url.rstrip('/')}/bind",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(16 * 1024 + 1)
            if response.status < 200 or response.status >= 300 or len(raw) > 16 * 1024:
                raise BootstrapDeniedError("warm binding returned an invalid response")
    except HTTPError as error:
        if 400 <= error.code < 500:
            raise BootstrapDeniedError(f"warm binding refused with status {error.code}") from error
        raise
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BootstrapDeniedError("warm binding returned invalid JSON") from error
    attempt_model_key = parsed.get("attemptModelKey") if isinstance(parsed, dict) else None
    if not isinstance(attempt_model_key, str) or not attempt_model_key:
        raise BootstrapDeniedError("warm binding returned no attempt model key")
    log("warm_runtime_bound", thumbprint=proof_key["thumbprint"])
    return attempt_model_key
