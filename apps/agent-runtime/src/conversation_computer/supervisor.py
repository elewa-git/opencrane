"""Supervise the one fenced bootstrap exchange before a ConversationComputer loop begins.

This module owns only retry policy. The later command-loop adapter receives already checked
execution coordinates and remains responsible for model work, interruption, elicitation, and
terminal behaviour. Keeping that split prevents a retrying transport concern from becoming a
second product-loop authority.
"""

import random
import time
from collections.abc import Callable
from urllib.error import HTTPError, URLError

from ..observability import log
from .bootstrap import (
    ConversationComputerBootstrapDeniedError,
    ConversationComputerBootstrapSettings,
    ConversationComputerExecution,
    bootstrap_execution as _bootstrap_execution,
)


def retry_delay(attempt: int) -> float:
    """Return a bounded jittered delay after a retryable bootstrap failure."""
    return min(30.0, (2 ** min(attempt, 5)) + random.uniform(0.0, 1.0))


def run(
    settings: ConversationComputerBootstrapSettings,
    bootstrap: Callable[[ConversationComputerBootstrapSettings], ConversationComputerExecution] = _bootstrap_execution,
    start_loop: Callable[[ConversationComputerExecution], None] | None = None,
    wait: Callable[[float], None] = time.sleep,
) -> None:
    """Bootstrap one admitted computer, then hand it once to the future product-loop adapter.

    A permanent denial exits the Pod because its Pod identity and immutable contract cannot change.
    Availability failures retry with a freshly read projected token inside ``bootstrap``. A returned
    execution is passed once to the loop adapter; this supervisor never starts, replaces, or resumes
    an execution itself.
    """
    if start_loop is None:
        raise RuntimeError("ConversationComputer loop adapter must be composed before runtime startup")
    attempts = 0
    while True:
        try:
            # Bootstrap rereads the projected token so retrying an unavailable server never caches
            # a credential beyond the request that used it.
            execution = bootstrap(settings)
            break
        except ConversationComputerBootstrapDeniedError as error:
            # A denied identity, contract, or lease has no Pod-local recovery path.
            log("conversation_computer_bootstrap_denied", computerId=settings.computer_id, errorType=type(error).__name__)
            return
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            # Transport and control-plane availability may change without changing execution trust.
            attempts += 1
            delay_seconds = retry_delay(attempts)
            log("conversation_computer_bootstrap_retry", computerId=settings.computer_id, errorType=type(error).__name__, retryInSeconds=round(delay_seconds, 2))
            wait(delay_seconds)
    # The server-derived execution is now the only input the product-loop adapter receives.
    start_loop(execution)
