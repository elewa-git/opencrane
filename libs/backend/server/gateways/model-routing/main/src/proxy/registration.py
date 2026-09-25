"""Complete the pinned proxy's callback registration before it accepts requests.

The proxy adds its virtual-key budget callback at import time; _add_proxy_hooks
then appends the ordinary hooks. Map order alone therefore cannot put our limiter
first. The image calls this helper once that real registration has completed.
https://github.com/BerriAI/litellm/blob/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm/proxy/utils.py
"""

import litellm

from .limiter import ReceiptLimiter


def establish_limiter_first(proxy_logging):
    """Move the registered limiter first while preserving every other safeguard.

    No callback is constructed, removed, duplicated or reordered relative to its
    peers. Unknown or ambiguous registration fails startup rather than silently
    qualifying a request whose earlier callback might already have dispatched.
    """
    limiter = proxy_logging.get_proxy_hook("parallel_request_limiter")
    callbacks = litellm.callbacks
    if (type(limiter) is not ReceiptLimiter or not isinstance(callbacks, list)
            or sum(callback is limiter for callback in callbacks) != 1
            or sum(isinstance(callback, ReceiptLimiter) for callback in callbacks) != 1):
        raise RuntimeError("Unqualified local limiter registration")
    callbacks[:] = [limiter, *(callback for callback in callbacks if callback is not limiter)]
