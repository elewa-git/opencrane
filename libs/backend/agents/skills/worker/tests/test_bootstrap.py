"""Focused fail-closed tests for the shared governed-skill bootstrap client."""

import importlib.util
import json
import pathlib
import tempfile
import unittest
from urllib.error import HTTPError


_MODULE_PATH = pathlib.Path(__file__).parents[1] / "src" / "bootstrap.py"
_SPEC = importlib.util.spec_from_file_location("governed_skill_bootstrap", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_WORKER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_WORKER)


class _Response:
    """Deterministic successful response seam."""

    def __init__(self, status: int, payload: object):
        """Capture the only status and JSON payload the worker needs."""
        self.status = status
        self._payload = payload

    def read(self) -> bytes:
        """Return the response body as UTF-8 JSON."""
        return json.dumps(self._payload).encode("utf-8")


class GovernedSkillBootstrapTests(unittest.TestCase):
    """Prove the worker sends only the exact acknowledgement or fails closed."""

    def _paths(self, reference: str = "skill-bootstrap-v1_" + "a" * 64) -> tuple[str, str]:
        """Create non-secret temporary projected-file equivalents."""
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        token_path = pathlib.Path(directory.name) / "token"
        reference_path = pathlib.Path(directory.name) / "reference"
        token_path.write_text("projected-token", encoding="utf-8")
        reference_path.write_text(reference, encoding="utf-8")
        return str(token_path), str(reference_path)

    def test_posts_only_the_opaque_reference_to_the_fixed_endpoint(self) -> None:
        """The bearer token stays in the header and no worker-selected payload field is sent."""
        token_path, reference_path = self._paths()
        captured: dict[str, object] = {}

        def open_request(request: object, timeout: float) -> _Response:
            captured["url"] = request.full_url
            captured["body"] = request.data
            captured["authorization"] = request.get_header("Authorization")
            captured["timeout"] = timeout
            return _Response(200, {"acknowledged": True, "workloadId": "workload-1"})

        workload_id = _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", token_path, reference_path, open_request)
        self.assertEqual(captured["url"], "http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime/skill-workloads:bootstrap")
        self.assertEqual(json.loads(captured["body"]), {"bootstrapReference": "skill-bootstrap-v1_" + "a" * 64})
        self.assertEqual(captured["authorization"], "Bearer projected-token")
        self.assertEqual(captured["timeout"], 10.0)
        self.assertEqual(workload_id, "workload-1")

    def test_rejects_missing_or_malformed_projected_inputs_before_network(self) -> None:
        """An absent token or malformed reference cannot trigger a best-effort request."""
        token_path, reference_path = self._paths("skill-bootstrap-v1_" + "g" * 64)
        with self.assertRaisesRegex(RuntimeError, "invalid"):
            _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", token_path, reference_path)
        with self.assertRaises(FileNotFoundError):
            _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", token_path + "-missing", reference_path)

    def test_rejects_nonminimal_response_and_redirects(self) -> None:
        """Only the exact acknowledgement succeeds; redirects cannot broaden the authority."""
        token_path, reference_path = self._paths()
        with self.assertRaisesRegex(RuntimeError, "rejected"):
            _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", token_path, reference_path, lambda request, timeout: _Response(200, {"acknowledged": True, "workloadId": "leak", "extra": "rejected"}))
        with self.assertRaisesRegex(RuntimeError, r"denied \(302\)"):
            _WORKER.acknowledge("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", token_path, reference_path, lambda request, timeout: (_ for _ in ()).throw(HTTPError(request.full_url, 302, "redirect", {}, None)))

    def test_rejects_invalid_base_url_before_reading_network(self) -> None:
        """A profile cannot turn bootstrap into an arbitrary external HTTP request."""
        token_path, reference_path = self._paths()
        with self.assertRaisesRegex(RuntimeError, "endpoint is invalid"):
            _WORKER.acknowledge("https://outside.example/api/internal/agent-runtime", token_path, reference_path)
        with self.assertRaisesRegex(RuntimeError, "endpoint is invalid"):
            _WORKER.acknowledge("http://outside.example:8081/api/internal/agent-runtime", token_path, reference_path)


if __name__ == "__main__":
    unittest.main()
