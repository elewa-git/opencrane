"""Bind public proof-key evidence to the admitted workload exactly once.

Bootstrap runs before the command stream. A client error means the reference is unknown, consumed,
expired, or mismatched and is therefore permanent for this process. Transport and server errors stay
retryable in ``runtime.py`` because the control plane may not have evaluated the one-use claim.
"""

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ..observability import log
from ..transport.http import post_json


class BootstrapDeniedError(RuntimeError):
    """Signal a permanent bootstrap refusal that must terminate this runtime."""


def perform_bootstrap(
    control_plane_url: str,
    token: str,
    bootstrap_reference: str,
    proof_key: dict[str, object],
) -> None:
    """Post the one-use reference and public proof evidence to the control plane.

    The projected workload token authenticates the Pod; the opaque reference selects the admitted
    assignment; the public key evidence becomes bound only if both agree with server authority.

    Raises:
        BootstrapDeniedError: For any permanent 4xx refusal or unexpected non-success status.
        HTTPError: For a retryable server-side HTTP failure.
        OSError: For transport failures before a binding result is known.
    """
    # These three values prove different things and are deliberately submitted together: the
    # reference names the server-created admission, the workload token authenticates the caller at
    # the HTTP boundary, and the public evidence records the key selected for this exact bootstrap.
    # None of the fields in this body is sufficient to admit a runtime on its own.
    body = {
        "bootstrapReference": bootstrap_reference,
        "proofPublicJwk": proof_key["publicJwk"],
        "proofKeyThumbprint": proof_key["thumbprint"],
    }
    try:
        # Bootstrap is the only endpoint allowed before the runtime has an authenticated command
        # stream. Keep this call synchronous so no attempt work can race ahead of proof binding.
        status = post_json(f"{control_plane_url.rstrip('/')}/bootstrap", token, body, timeout=30)
    except HTTPError as error:
        # A 4xx is a decision, not an availability failure. Retrying it could turn a replayed or
        # mismatched one-use reference into work if server state later changed.
        if 400 <= error.code < 500:
            raise BootstrapDeniedError(f"bootstrap refused with status {error.code}") from error
        raise
    # ``post_json`` normally raises for HTTP errors, but an injected/test transport may return an
    # unexpected status directly. Treat that as a permanent refusal rather than silently opening a
    # stream whose proof-key binding is unknown.
    if status < 200 or status >= 300:
        raise BootstrapDeniedError(f"bootstrap returned unexpected status {status}")
    # Log only the public thumbprint. The projected token and opaque bootstrap reference remain out
    # of observability fields because either could become useful replay material outside this Pod.
    log("bootstrap_bound", thumbprint=proof_key["thumbprint"])


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
