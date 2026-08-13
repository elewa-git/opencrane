"""Holds the lock that guards both pending-result registries.

One resume command can carry saved tool results, saved participant answers, or both. Those two kinds
live in separate registries (``pending_tools`` and ``pending_elicitations``), but a resume has to
check and empty both of them as a single step. They therefore share this lock instead of taking one
each: with two locks, a second resume arriving at the same moment could see the tool calls already
taken while the questions were still waiting, and resume the model with half an answer set.

The lock sits in its own module so both registries can import it without importing each other.
"""

import threading


# Re-entrant because one caller holds this lock while calling helpers that take it again. A plain
# Lock would deadlock on the second acquire.
PENDING_RESULT_LOCK = threading.RLock()
