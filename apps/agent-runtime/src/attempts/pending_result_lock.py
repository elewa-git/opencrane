"""Holds the lock that guards both pending-result registries.

A resume can carry saved tool results and saved participant answers, and has to check and empty both
registries as one step — so they share this lock rather than taking one each. The lock lives in its
own module so ``pending_tools`` and ``pending_elicitations`` can use it without importing each other.
"""

import threading


# Re-entrant: a caller holds this while calling helpers that take it again.
PENDING_RESULT_LOCK = threading.RLock()
