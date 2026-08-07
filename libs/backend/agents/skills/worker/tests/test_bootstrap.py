"""Focused fail-closed checks for the governed skill bootstrap client."""

import importlib.util
import json
import pathlib
import tempfile
import unittest


_PATH = pathlib.Path(__file__).parents[1] / "src" / "bootstrap.py"
_SPEC = importlib.util.spec_from_file_location("governed_skill_bootstrap", _PATH)
assert _SPEC and _SPEC.loader
_WORKER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_WORKER)


class _Response:
    """Small successful-response seam."""

    def __init__(self, status: int, payload: object) -> None:
        """Store the exact status and JSON payload returned by a fake endpoint."""
        self.status = status
        self.payload = payload

    def read(self) -> bytes:
        """Encode the fake reply as JSON bytes."""
        return json.dumps(self.payload).encode("utf-8")


class BootstrapTests(unittest.TestCase):
    """Prove a worker sends only the opaque reference to its fixed authority."""

    def test_acknowledges_only_the_fixed_endpoint(self) -> None:
        """Keep the bearer token in the header and policy-free payload."""
        with tempfile.TemporaryDirectory() as directory:
            token = pathlib.Path(directory) / "token"
            reference = pathlib.Path(directory) / "reference"
            token.write_text("projected-token", encoding="utf-8")
            reference.write_text("skill-bootstrap-v1_" + "a" * 64, encoding="utf-8")
            captured: dict[str, object] = {}

            def _Open(request: object, timeout: float) -> _Response:
                captured["url"] = request.full_url
                captured["body"] = request.data
                captured["authorization"] = request.get_header("Authorization")
                captured["timeout"] = timeout
                return _Response(200, {"acknowledged": True, "workloadId": "workload-1"})

            workload_id = _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", str(token), str(reference), _Open)
            self.assertEqual(captured["url"], "http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime/skill-workloads:bootstrap")
            self.assertEqual(json.loads(captured["body"]), {"bootstrapReference": "skill-bootstrap-v1_" + "a" * 64})
            self.assertEqual(captured["authorization"], "Bearer projected-token")
            self.assertEqual(workload_id, "workload-1")

    def test_rejects_an_external_bootstrap_endpoint(self) -> None:
        """A worker profile must never redirect the acknowledgement to an arbitrary host."""
        with self.assertRaisesRegex(RuntimeError, "endpoint is invalid"):
            _WORKER._acknowledgement_url("https://outside.example/api/internal/agent-runtime")

    def test_rejects_a_non_minimal_acknowledgement(self) -> None:
        """Keep a compromised internal endpoint from exhausting the worker's small process."""
        with tempfile.TemporaryDirectory() as directory:
            token = pathlib.Path(directory) / "token"
            reference = pathlib.Path(directory) / "reference"
            token.write_text("projected-token", encoding="utf-8")
            reference.write_text("skill-bootstrap-v1_" + "a" * 64, encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "was rejected"):
                _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", str(token), str(reference), lambda request, timeout: _Response(200, {"acknowledged": True, "padding": "x" * 4096}))
