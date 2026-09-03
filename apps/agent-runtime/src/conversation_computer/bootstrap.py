"""Read one fixed Sandbox bootstrap contract and exchange it for fenced execution coordinates.

The Agent Sandbox Pod receives its endpoint and protocol revision from an immutable ConfigMap, its
computer identifier from the Downward API, and a short-lived token from a projected volume. This
module joins those three independently owned inputs without accepting a caller-selected execution
or preserving the token after a request completes.
"""

import json
import os
from dataclasses import dataclass
from collections.abc import Callable
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

_CONFIG_DIRECTORY = "/var/run/opencrane/conversation-computer"
_TOKEN_PATH = "/var/run/secrets/opencrane/conversation-computer/token"
_PROTOCOL_VERSION = "conversation-computer-runtime.v1"
_TOKEN_AUDIENCE = "opencrane-conversation-computer-runtime"


class ConversationComputerBootstrapDeniedError(RuntimeError):
    """Signal a permanent refusal to bootstrap this Sandbox Pod's admitted computer."""


@dataclass(frozen=True)
class ConversationComputerBootstrapSettings:
    """Hold the fixed runtime contract mounted into one Agent Sandbox Pod."""

    endpoint: str
    computer_id: str
    token_path: str


@dataclass(frozen=True)
class ConversationComputerExecution:
    """Hold the server-derived execution coordinates released after Pod identity verification."""

    computer_id: str
    conversation_id: str
    execution_id: str
    lease_generation: int


def read_bootstrap_settings(
    read_file: Callable[[str], str] | None = None,
    environment: Callable[[str], str | None] | None = None,
) -> ConversationComputerBootstrapSettings:
    """Read and validate the immutable ConfigMap, Downward API, and projected-token locations.

    The protocol and audience files are checked locally before any outbound request. A substituted
    ConfigMap therefore fails closed instead of making the runtime negotiate an older protocol.
    """
    read = read_file or _read_file
    get_environment = environment or os.environ.get
    # 1. Accept only the endpoint released by the mounted protocol revision.
    endpoint = read(f"{_CONFIG_DIRECTORY}/endpoint").strip()
    protocol_version = read(f"{_CONFIG_DIRECTORY}/protocol-version").strip()
    token_audience = read(f"{_CONFIG_DIRECTORY}/token-audience").strip()
    parsed_endpoint = urlparse(endpoint)
    if parsed_endpoint.scheme not in ("http", "https") or not parsed_endpoint.netloc or parsed_endpoint.params or parsed_endpoint.query or parsed_endpoint.fragment or protocol_version != _PROTOCOL_VERSION or token_audience != _TOKEN_AUDIENCE:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer runtime bootstrap contract is invalid")
    # 2. Require the identity label admission policy stamped onto this exact Pod.
    computer_id = (get_environment("OPENCRANE_CONVERSATION_COMPUTER_ID") or "").strip()
    if not computer_id or len(computer_id) > 128:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer runtime computer identity is invalid")
    # 3. Retain only the token location so kubelet rotation is observed at request time.
    return ConversationComputerBootstrapSettings(endpoint=endpoint.rstrip("/"), computer_id=computer_id, token_path=_TOKEN_PATH)


def bootstrap_execution(
    settings: ConversationComputerBootstrapSettings,
    read_file: Callable[[str], str] | None = None,
    open_request: Callable[[Request], object] | None = None,
) -> ConversationComputerExecution:
    """Exchange the projected Pod token for one server-derived active computer execution.

    A 401, 403, or malformed successful response is permanent because retrying cannot change the
    Pod identity or its admitted lease. Transport and server availability failures propagate for
    the process supervisor to retry with a freshly projected token.
    """
    read = read_file or _read_file
    token = read(settings.token_path).strip()
    if not token:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer runtime token is empty")
    request = Request(
        f"{settings.endpoint}/bootstrap",
        data=json.dumps({"computerId": settings.computer_id}, separators=(",", ":")).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with (open_request or _open_request)(request) as response:
            if getattr(response, "status", None) != 200:
                raise RuntimeError("ConversationComputer bootstrap returned an unexpected status")
            return _read_execution(response.read(), settings.computer_id)
    except HTTPError as error:
        if error.code in (401, 403, 400):
            raise ConversationComputerBootstrapDeniedError("ConversationComputer runtime bootstrap was denied") from error
        raise


def _read_execution(value: bytes, expected_computer_id: str) -> ConversationComputerExecution:
    """Validate the complete response before coordinates can enter a future runtime command loop."""
    try:
        response = json.loads(value.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer bootstrap returned invalid JSON") from error
    if not isinstance(response, dict) or set(response) != {"computerId", "conversationId", "executionId", "leaseGeneration"}:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer bootstrap returned invalid coordinates")
    computer_id = response["computerId"]
    conversation_id = response["conversationId"]
    execution_id = response["executionId"]
    lease_generation = response["leaseGeneration"]
    if computer_id != expected_computer_id or not all(isinstance(identifier, str) and 0 < len(identifier) <= 128 for identifier in (computer_id, conversation_id, execution_id)) or not isinstance(lease_generation, int) or isinstance(lease_generation, bool) or lease_generation < 1:
        raise ConversationComputerBootstrapDeniedError("ConversationComputer bootstrap returned mismatched coordinates")
    return ConversationComputerExecution(computer_id=computer_id, conversation_id=conversation_id, execution_id=execution_id, lease_generation=lease_generation)


def _read_file(path: str) -> str:
    """Read one mounted ConfigMap or projected-token file without caching its contents."""
    with open(path, "r", encoding="utf-8") as file:
        return file.read()


def _open_request(request: Request) -> object:
    """Open one bounded bootstrap request through Python's standard HTTPS transport."""
    return urlopen(request, timeout=10)
