"""Coordinate one terminal candidate across attempt and stream concurrency.

The gate provides process-local single-writer behaviour: only the first completion/failure claimant
may deliver. It keeps retrying that same candidate only when delivery may have succeeded but the
network response was lost. An explicit HTTP refusal is permanent here; the control plane's candidate
idempotency remains the durable exactly-once boundary.
"""

import threading
from collections.abc import Callable
from urllib.error import HTTPError, URLError

from ..constants import TERMINAL_DELIVERY_RETRY_SECONDS
from ..observability import log


class TerminalGate:
    """Guard one stable terminal candidate with a cancellation-aware lock."""

    def __init__(self, cancel_event: threading.Event) -> None:
        """Bind the terminal writer to the same signal that stops the active model loop."""
        self._cancel_event = cancel_event
        self._lock = threading.Lock()
        self._posted = False

    def post_completion(
        self,
        post_candidate: Callable[[dict[str, object]], None],
        terminal_candidate: dict[str, object],
    ) -> bool:
        """Claim and deliver the terminal candidate.

        The claim is recorded before network I/O so a concurrent completion path cannot author a
        second terminal while the first path retries. A false result means another terminal already
        won or server-owned cancellation stopped local delivery.

        Returns:
            ``True`` after delivery returns successfully; otherwise ``False``.
        """
        with self._lock:
            if self._posted or self._cancel_event.is_set():
                return False
            # From this point this exact candidate is the sole local terminal writer, even when its
            # first HTTP response is lost.
            self._posted = True
        while not self._cancel_event.is_set():
            try:
                post_candidate(terminal_candidate)
                return True
            except HTTPError as error:
                # An HTTP response proves the control plane made a decision. Replaying a permanent
                # refusal would create an unbounded loop and would contradict its admission policy.
                # Record only stable coordinates and status; response bodies may contain sensitive
                # server detail and are neither read nor logged.
                log(
                    "terminal_candidate_refused",
                    runId=terminal_candidate.get("runId"),
                    attempt=terminal_candidate.get("attempt"),
                    candidateId=terminal_candidate.get("candidateId"),
                    status=error.code,
                )
                error.close()
                raise
            except (URLError, OSError) as error:
                # Reuse terminal_candidate unchanged. Creating a replacement here would defeat
                # control-plane idempotency and could produce two terminal events. These failures
                # are ambiguous: the server may have persisted the candidate before the connection
                # was lost, so the stable identifier is the safe recovery key.
                log(
                    "terminal_candidate_retry",
                    runId=terminal_candidate.get("runId"),
                    attempt=terminal_candidate.get("attempt"),
                    candidateId=terminal_candidate.get("candidateId"),
                    errorType=type(error).__name__,
                )
                self._cancel_event.wait(TERMINAL_DELIVERY_RETRY_SECONDS)
        return False
