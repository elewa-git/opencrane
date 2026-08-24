"""Fail-closed entrypoint for the future isolated MCP bundle worker."""

import json
import sys


def run() -> int:
    """Refuse to execute until a server-issued assignment protocol exists."""
    print(json.dumps({"component": "mcpb-validator", "event": "assignment_unavailable"}, sort_keys=True), file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(run())
