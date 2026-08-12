"""Share one process-local lock across tool and elicitation result correlation."""

import threading


PENDING_RESULT_LOCK = threading.RLock()
