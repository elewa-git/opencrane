"""Check every cache-pair match through the network-disabled proxy test harness."""

from copy import deepcopy
import unittest

from litellm import DualCache
from litellm.proxy.utils import InternalUsageCache

from ..limiter import ReceiptLimiter, _cache_integer, _snapshot_reset


class LimiterSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.limiter = ReceiptLimiter(InternalUsageCache(DualCache()))
        self.keys = ["{api_key:one}:window", "{api_key:one}:requests", "{team:two}:window", "{team:two}:tokens"]
        self.values = [100, 2, 105, 12]
        self.metadata = {
            self.keys[0]: {"requests_limit": 1, "tokens_limit": None, "max_parallel_requests_limit": None, "window_size": 60, "descriptor_key": "api_key"},
            self.keys[2]: {"requests_limit": None, "tokens_limit": 10, "max_parallel_requests_limit": None, "window_size": 60, "descriptor_key": "team"},
        }
        self.result = self.limiter.is_cache_list_over_limit(self.keys, self.values, self.metadata)

    def test_all_exceeded_limits_use_the_latest_real_reset(self):
        self.assertEqual(self.result["overall_code"], "OVER_LIMIT")
        self.assertEqual(self.result.reset_at_epoch_ms, 165_000)
        self.assertEqual(_snapshot_reset(self.result, self.keys, [b"100", b"2", "105", "12"], self.metadata), 165_000)

    def test_any_unmatched_or_missing_exceeded_snapshot_closes_the_whole_proof(self):
        changes = (
            lambda result, keys, values, metadata: result["statuses"].pop(),
            lambda result, keys, values, metadata: keys.pop(),
            lambda result, keys, values, metadata: values.pop(),
            lambda result, keys, values, metadata: values.__setitem__(2, None),
            lambda result, keys, values, metadata: values.__setitem__(3, 10),
            lambda result, keys, values, metadata: keys.__setitem__(3, "{team:other}:tokens"),
            lambda result, keys, values, metadata: result["statuses"][1].__setitem__("descriptor_key", "other"),
            lambda result, keys, values, metadata: result["statuses"][1].__setitem__("current_limit", True),
            lambda result, keys, values, metadata: result["statuses"][1].__setitem__("current_limit", 11),
            lambda result, keys, values, metadata: result["statuses"][1].__setitem__("rate_limit_type", "unknown"),
            lambda result, keys, values, metadata: result["statuses"][1].__setitem__("code", "unknown"),
            lambda result, keys, values, metadata: metadata[keys[2]].__setitem__("window_size", 0),
            lambda result, keys, values, metadata: metadata[keys[2]].__setitem__("window_size", True),
            lambda result, keys, values, metadata: metadata[keys[2]].__setitem__("window_size", 9_007_199_254_740_991),
        )
        for index, change in enumerate(changes):
            with self.subTest(change=index):
                result, keys, values, metadata = deepcopy((self.result, self.keys, self.values, self.metadata))
                change(result, keys, values, metadata)
                self.assertIsNone(_snapshot_reset(result, keys, values, metadata))

    def test_unknown_cache_values_never_become_timestamps(self):
        for value in (True, False, -1, 1.5, float("nan"), "01", "-1", "1.0", "1e3", b"\xff", None, {}):
            with self.subTest(value=value):
                self.assertIsNone(_cache_integer(value))
