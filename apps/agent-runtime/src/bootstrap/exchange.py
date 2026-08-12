"""Bind public proof-key evidence to the admitted workload exactly once.

Bootstrap runs before the command stream. A client error means the reference is unknown, consumed,
expired, or mismatched and is therefore permanent for this process. Transport and server errors stay
retryable in ``runtime.py`` because the control plane may not have evaluated the one-use claim.
"""

from urllib.error import HTTPError

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
