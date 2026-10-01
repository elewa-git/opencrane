"""Prove both offline harness guards without importing their vendor dependencies."""

from pathlib import Path
import subprocess
import sys
import unittest


# Audit hooks cannot be removed, so each harness gets its own short-lived process.
GUARD_PROBE = r'''
import ast
from pathlib import Path
import socket
import sys

path = Path(sys.argv[1])
tree = ast.parse(path.read_text(), filename=str(path))
guards = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "deny_network"]
assert len(guards) == 1
registrations = [
    node for node in tree.body if isinstance(node, ast.Expr)
    and isinstance(node.value, ast.Call)
    and ast.unparse(node.value) == "sys.addaudithook(deny_network)"
]
vendor_imports = [
    node for node in tree.body
    if (isinstance(node, ast.Import) and any(
        entry.name.split(".")[0] in ("httpx", "litellm", "openai") for entry in node.names
    )) or (isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "litellm")
]
assert len(registrations) == 1 and vendor_imports
assert guards[0].lineno < registrations[0].lineno < min(node.lineno for node in vendor_imports)

# Execute the actual hook body, not a second implementation of its decision.
state = {"NETWORK_ATTEMPTS": []}
exec(compile(ast.Module(body=guards, type_ignores=[]), str(path), "exec"), state)
sys.addaudithook(state["deny_network"])

def backstop(event, args):
    """Prevent real I/O if the tested hook stops rejecting an outbound operation."""
    if event in (
        "socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
        "socket.gethostbyaddr", "socket.getnameinfo", "socket.sendto", "socket.sendmsg",
    ):
        raise AssertionError("The harness allowed an outbound operation: " + event)

sys.addaudithook(backstop)
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as stream:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as datagram:
        assert state["NETWORK_ATTEMPTS"] == [], "Allocation must not count as outbound I/O"
        operations = [
            ("socket.getaddrinfo", lambda: socket.getaddrinfo("provider.invalid", 443)),
            ("socket.gethostbyname", lambda: socket.gethostbyname("provider.invalid")),
            ("socket.gethostbyaddr", lambda: socket.gethostbyaddr("192.0.2.1")),
            ("socket.getnameinfo", lambda: socket.getnameinfo(("192.0.2.1", 443), 0)),
            ("socket.connect", lambda: stream.connect(("192.0.2.1", 443))),
            ("socket.connect", lambda: stream.connect_ex(("192.0.2.1", 443))),
            ("socket.sendto", lambda: datagram.sendto(b"synthetic", ("192.0.2.1", 443))),
            ("socket.sendmsg", lambda: datagram.sendmsg([b"synthetic"], [], 0, ("192.0.2.1", 443))),
        ]
        expected = []
        for event, operation in operations:
            try:
                operation()
            except RuntimeError as error:
                assert "Network disabled" in str(error), error
            else:
                raise AssertionError("The harness allowed " + event)
            expected.append(event)
            assert state["NETWORK_ATTEMPTS"] == expected, "Blocked attempts must remain recorded"
print("allocation allowed; eight outbound operations blocked and retained")
'''


class OfflineNetworkGuardTest(unittest.TestCase):
    """Keep import-time detection strict without confusing allocation with a request."""

    def test_router_guard(self):
        self.check_guard("router-retry-contract.py")

    def test_preforward_guard(self):
        self.check_guard("preforward-contract.py")

    def check_guard(self, filename):
        """Use the host's standard library only; no proxy, provider or image is started."""
        path = Path(__file__).with_name(filename)
        result = subprocess.run(
            [sys.executable, "-I", "-c", GUARD_PROBE, str(path)],
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            "allocation allowed; eight outbound operations blocked and retained",
        )


if __name__ == "__main__":
    unittest.main()
