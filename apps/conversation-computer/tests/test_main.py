"""Test the conversation-computer readiness contract without opening a listener."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.main import _configuration


class ConfigurationTests(unittest.TestCase):
    """Prove readiness requires exact history and lease-generation coordinates."""

    def test_accepts_complete_coordinates(self) -> None:
        """Return the frozen coordinates when every release-owned value is present."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_GENERATION": "3",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_HISTORY_STORE_ENDPOINT": "kurrentdb:2113",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(_configuration(), {"computerId": "computer-1", "generation": "3", "historyEndpoint": "kurrentdb:2113", "leaseId": "lease-1"})

    def test_rejects_missing_generation(self) -> None:
        """Fail readiness when the sandbox lacks a generation fence."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_HISTORY_STORE_ENDPOINT": "kurrentdb:2113",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENCRANE_COMPUTER_GENERATION is required"):
                _configuration()


if __name__ == "__main__":
    unittest.main()
