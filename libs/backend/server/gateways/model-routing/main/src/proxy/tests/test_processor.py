"""Check receipt eligibility and response stripping in the offline proxy harness."""

from copy import deepcopy
import unittest

import litellm
from fastapi import Response
from litellm import DualCache
from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.utils import InternalUsageCache

from ..limiter import ReceiptLimiter
from ..processor import _qualifiable_request, _without_reserved_headers


class ProcessorQualificationTests(unittest.TestCase):
    def setUp(self):
        self.old_callbacks = litellm.callbacks
        litellm.callbacks = [ReceiptLimiter(InternalUsageCache(DualCache()))]
        self.data = {"model": "primary", "messages": [], "max_tokens": 1, "n": 1, "stream": False,
                     "num_retries": 0, "max_retries": 0, "disable_fallbacks": True}
        self.auth = UserAPIKeyAuth(models=["primary"], key_alias="attempt-one", metadata={
            "opencrane_scope": "agent-runtime-attempt", "opencrane_key_alias": "attempt-one",
        })

    def tearDown(self):
        litellm.callbacks = self.old_callbacks

    def test_only_the_existing_attempt_configuration_is_eligible(self):
        self.assertTrue(_qualifiable_request(self.data, self.auth, "acompletion"))
        mutations = (
            lambda data, auth: data.__setitem__("prompt_id", "unqualified-template"),
            lambda data, auth: data.__setitem__("success_callback", "unqualified"),
            lambda data, auth: data.__setitem__("user_config", {}),
            lambda data, auth: data.__setitem__("num_retries", True),
            lambda data, auth: data.__setitem__("max_retries", 1),
            lambda data, auth: data.__setitem__("stream", True),
            lambda data, auth: auth.metadata.__setitem__("logging", []),
            lambda data, auth: auth.metadata.__setitem__("opencrane_scope", "other"),
            lambda data, auth: auth.metadata.__setitem__("opencrane_key_alias", "other"),
            lambda data, auth: setattr(auth, "models", ["primary", "other"]),
            lambda data, auth: setattr(auth, "team_id", "unqualified-team"),
            lambda data, auth: setattr(auth, "team_metadata", {"callback_settings": {}}),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(change=index):
                data, auth = deepcopy(self.data), self.auth.model_copy(deep=True)
                mutate(data, auth)
                self.assertFalse(_qualifiable_request(data, auth, "acompletion"))
        self.assertFalse(_qualifiable_request(self.data, self.auth, "aembedding"))
        litellm.callbacks.insert(0, object())
        self.assertFalse(_qualifiable_request(self.data, self.auth, "acompletion"))

    def test_all_reserved_response_headers_are_removed(self):
        response = Response(headers={"X-OpenCrane-Preforward-Receipt": "spoof", "x-opencrane-other": "spoof", "retry-after": "1"})
        self.assertIs(_without_reserved_headers(response), response)
        self.assertEqual(response.headers["retry-after"], "1")
        self.assertFalse(any(name.startswith("x-opencrane-") for name in response.headers))
