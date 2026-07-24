"""Focused tests for authoring-only verified bundle intake primitives."""

import hashlib
import importlib.util
import io
import pathlib
import sys
import tarfile
import tempfile
import unittest


_ROOT = pathlib.Path(__file__).parents[3]
_BOOTSTRAP_PATH = _ROOT / "libs/backend/agents/skills/worker/src/bootstrap.py"
_AUTHORING_PATH = _ROOT / "apps/skill-authoring/src/authoring_worker.py"
_BOOTSTRAP_SPEC = importlib.util.spec_from_file_location("bootstrap", _BOOTSTRAP_PATH)
assert _BOOTSTRAP_SPEC and _BOOTSTRAP_SPEC.loader
_BOOTSTRAP = importlib.util.module_from_spec(_BOOTSTRAP_SPEC)
sys.modules["bootstrap"] = _BOOTSTRAP
_BOOTSTRAP_SPEC.loader.exec_module(_BOOTSTRAP)
_AUTHORING_SPEC = importlib.util.spec_from_file_location("authoring_worker", _AUTHORING_PATH)
assert _AUTHORING_SPEC and _AUTHORING_SPEC.loader
_AUTHORING = importlib.util.module_from_spec(_AUTHORING_SPEC)
_AUTHORING_SPEC.loader.exec_module(_AUTHORING)


class _Response:
    """In-memory bounded server response seam."""

    def __init__(self, payload: bytes, address: str | None = None, length: str | None = None):
        """Build response metadata from immutable bytes unless a negative test overrides it."""
        self.status = 200
        self.headers = {"content-length": length or str(len(payload)), "x-opencrane-content-address": address or f"sha256:{hashlib.sha256(payload).hexdigest()}"}
        self._body = io.BytesIO(payload)

    def read(self, amount: int = -1) -> bytes:
        """Read the next bounded byte segment."""
        return self._body.read(amount)


class AuthoringWorkerTests(unittest.TestCase):
    """Prove authoring bundle bytes cannot escape their server-selected integrity and archive bounds."""

    def _token(self, directory: pathlib.Path) -> pathlib.Path:
        """Create a non-secret projected-token equivalent for one test."""
        token = directory / "token"
        token.write_text("projected-token", encoding="utf-8")
        return token

    def _archive(self, path: pathlib.Path, members: dict[str, bytes]) -> None:
        """Create one small gzip tar fixture with the supplied regular file entries."""
        with tarfile.open(path, "w:gz") as bundle:
            for name, content in members.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                bundle.addfile(entry, io.BytesIO(content))

    def test_downloads_only_the_fixed_internal_route_and_atomically_verifies_hash(self) -> None:
        """The projected token is sent only to the authoring input route and bytes become durable after hash verification."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            captured: dict[str, object] = {}

            def open_request(request: object, timeout: float) -> _Response:
                captured["url"] = request.full_url
                captured["authorization"] = request.get_header("Authorization")
                captured["timeout"] = timeout
                return _Response(b"candidate")

            destination = _AUTHORING.download_bundle("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), directory / "bundle.tar.gz", open_request)
            self.assertEqual(destination.read_bytes(), b"candidate")
            self.assertEqual(captured["url"], "http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime/skill-authoring-workloads/workload-1/input")
            self.assertEqual(captured["authorization"], "Bearer projected-token")
            self.assertEqual(captured["timeout"], 10.0)

    def test_rejects_mismatched_or_oversized_download_without_retaining_bytes(self) -> None:
        """Transport length and digest are both mandatory before the worker retains an archive."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            destination = directory / "bundle.tar.gz"
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                _AUTHORING.download_bundle("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), destination, lambda request, timeout: _Response(b"candidate", address=f"sha256:{'0' * 64}"))
            self.assertFalse(destination.exists())
            with self.assertRaisesRegex(RuntimeError, "rejected"):
                _AUTHORING.download_bundle("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), destination, lambda request, timeout: _Response(b"candidate", length=str(16 * 1024 * 1024 + 1)))
            self.assertFalse(destination.exists())

    def test_extracts_only_a_bounded_regular_file_bundle_with_required_files(self) -> None:
        """A valid candidate receives a new private extracted tree after exact structural checks."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            archive = directory / "bundle.tar.gz"
            self._archive(archive, {"SKILL.md": b"# Example", "pyproject.toml": b"[project]\nname='example'", "tests/test_example.py": b"def test_example(): pass\n"})
            extracted = _AUTHORING.extract_bundle(archive, directory / "extracted")
            self.assertEqual((extracted / "SKILL.md").read_bytes(), b"# Example")

    def test_rejects_traversal_and_missing_contract_files(self) -> None:
        """No archive path can escape /tmp and a candidate cannot omit the required authoring structure."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            unsafe = directory / "unsafe.tar.gz"
            self._archive(unsafe, {"../escape": b"bad"})
            with self.assertRaisesRegex(RuntimeError, "unsafe path"):
                _AUTHORING.extract_bundle(unsafe, directory / "unsafe")
            incomplete = directory / "incomplete.tar.gz"
            self._archive(incomplete, {"SKILL.md": b"# Example"})
            with self.assertRaisesRegex(RuntimeError, "missing required"):
                _AUTHORING.extract_bundle(incomplete, directory / "incomplete")

    def test_rejects_links_even_when_their_target_stays_inside_the_archive(self) -> None:
        """Links are never an authoring-bundle feature because extraction must remain path-inert."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            archive = directory / "linked.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                link = tarfile.TarInfo("SKILL.md")
                link.type = tarfile.SYMTYPE
                link.linkname = "inside"
                bundle.addfile(link)
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                _AUTHORING.extract_bundle(archive, directory / "linked")

    def test_rejects_a_highly_compressible_oversized_member_from_its_header(self) -> None:
        """A gzip tar bomb never reaches extraction because streaming inspection rejects its file header first."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            archive = directory / "oversized.tar.gz"
            self._archive(archive, {"oversized.py": b"\x00" * (8 * 1024 * 1024 + 1)})
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                _AUTHORING.extract_bundle(archive, directory / "oversized")

    def test_runs_only_fixed_offline_validator_commands_after_dependency_and_secret_checks(self) -> None:
        """A candidate cannot choose a command, add dependencies, or receive raw validator output in its report."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            (directory / "SKILL.md").write_text("# Example", encoding="utf-8")
            (directory / "pyproject.toml").write_text("[project]\nname='example'\nversion='1.0.0'", encoding="utf-8")
            (directory / "tests").mkdir()
            calls: list[tuple[str, ...]] = []
            tools = directory / "tools"
            tools.mkdir()
            database = directory / "database"
            database.mkdir()
            (database / "main.cvd").write_bytes(b"database")
            original_commands = _AUTHORING._VALIDATOR_COMMANDS
            original_malware = _AUTHORING._MALWARE_COMMAND
            try:
                _AUTHORING._VALIDATOR_COMMANDS = tuple((str(tools / f"tool-{index}"), "check") for index in range(3))
                _AUTHORING._MALWARE_COMMAND = (str(tools / "scanner"), "scan")
                for command in (*_AUTHORING._VALIDATOR_COMMANDS, _AUTHORING._MALWARE_COMMAND):
                    path = pathlib.Path(command[0])
                    path.write_text("tool", encoding="utf-8")
                    path.chmod(0o700)
                reports = _AUTHORING.validate_bundle(directory, lambda command, cwd, timeout: calls.append(tuple(command)) or 0, database)
            finally:
                _AUTHORING._VALIDATOR_COMMANDS = original_commands
                _AUTHORING._MALWARE_COMMAND = original_malware
            self.assertEqual(len(calls), 4)
            self.assertEqual(reports, ({"passed": True, "summary": "format, type, and test checks passed", "checksRun": 3}, {"passed": True, "summary": "dependency policy, secret scan, and offline malware scan passed", "checksRun": 3}))

    def test_rejects_candidate_dependencies_and_plaintext_secrets_before_tests_start(self) -> None:
        """The initial policy is intentionally stricter than a networked package audit: candidates have no dependencies at all."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            (directory / "pyproject.toml").write_text("[project]\nname='example'\ndependencies=['requests']", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "unsupported dependencies"):
                _AUTHORING.validate_bundle(directory)
            (directory / "pyproject.toml").write_text("[project]\nname='example'", encoding="utf-8")
            (directory / "skill.py").write_text("api_key = 'not-a-real-secret-but-long'", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "plaintext secret"):
                _AUTHORING.validate_bundle(directory)

    def test_rejects_nested_or_build_time_dependency_metadata(self) -> None:
        """No alternate Python packaging table can bypass the initial zero-dependency policy."""
        with tempfile.TemporaryDirectory() as raw:
            project = pathlib.Path(raw) / "pyproject.toml"
            project.write_text("[project]\nname='example'\n[build-system]\nrequires=['setuptools']", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "unsupported dependencies"):
                _AUTHORING._assert_dependency_policy(project)
            project.write_text("[project]\nname='example'\n[tool.poetry]\ndependencies={ requests = '^2.0' }", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "unsupported dependencies"):
                _AUTHORING._assert_dependency_policy(project)


if __name__ == "__main__":
    unittest.main()
