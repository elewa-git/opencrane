"""Keep the actual registered limiter ahead of intact budget and logging callbacks."""

from types import SimpleNamespace
import unittest

import litellm
from litellm import DualCache
from litellm.proxy.utils import InternalUsageCache

from ..limiter import ReceiptLimiter
from ..registration import establish_limiter_first


class StartupRegistrationTests(unittest.TestCase):
    def test_preserves_all_other_instances_and_order(self):
        saved = litellm.callbacks
        limiter = ReceiptLimiter(InternalUsageCache(DualCache()))
        earlier, later = object(), object()
        try:
            litellm.callbacks = [earlier, limiter, later]
            original_list = litellm.callbacks
            logging = SimpleNamespace(get_proxy_hook=lambda name: limiter)
            establish_limiter_first(logging)
            self.assertIs(litellm.callbacks, original_list)
            self.assertEqual(litellm.callbacks, [limiter, earlier, later])
            establish_limiter_first(logging)
            self.assertEqual(litellm.callbacks, [limiter, earlier, later])
        finally:
            litellm.callbacks = saved

    def test_missing_foreign_and_duplicate_registrations_fail_closed(self):
        saved = litellm.callbacks
        limiter = ReceiptLimiter(InternalUsageCache(DualCache()))
        other = ReceiptLimiter(InternalUsageCache(DualCache()))
        try:
            for mapped, callbacks in ((None, [limiter]), (other, [limiter]), (limiter, []), (limiter, [limiter, limiter]), (limiter, [limiter, other])):
                with self.subTest(callbacks=len(callbacks)):
                    litellm.callbacks = callbacks
                    with self.assertRaises(RuntimeError):
                        establish_limiter_first(SimpleNamespace(get_proxy_hook=lambda name: mapped))
                    self.assertEqual(litellm.callbacks, callbacks)
        finally:
            litellm.callbacks = saved
