"""Tests for the fail-closed MCP bundle worker entrypoint."""

import contextlib
import io
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import mcpb_validator


class McpbValidatorTests(unittest.TestCase):
    """Proves this image cannot execute a bundle before its assignment protocol exists."""

    def test_refuses_execution_without_an_assignment(self) -> None:
        """Returns a failure and only emits the stable non-sensitive reason."""
        output = io.StringIO()

        with contextlib.redirect_stderr(output):
            result = mcpb_validator.run()

        self.assertEqual(result, 1)
        self.assertEqual(output.getvalue(), '{"component": "mcpb-validator", "event": "assignment_unavailable"}\n')
