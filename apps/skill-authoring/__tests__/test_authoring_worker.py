"""Focused tests for authoring-only verified bundle intake primitives."""

import hashlib
import importlib.util
import io
import pathlib
import sys
import tarfile
import tempfile
import unittest
from unittest import mock


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


class _CompletionResponse:
    """In-memory response seam for the fixed terminal completion route."""

    def __init__(self, body: bytes = b'{"completed":true}', status: int = 200):
        """Build one terminal authority reply without including source or credential material."""
        self.status = status
        self._body = io.BytesIO(body)

    def read(self, amount: int = -1) -> bytes:
        """Read the bounded JSON response body."""
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
            self.assertEqual(captured["url"], "http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime/skill-authoring-validations/workload-1/input")
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

    def test_posts_only_a_bounded_terminal_outcome_to_the_fixed_completion_route(self) -> None:
        """Completion rereads the projected token and accepts only the server's exact acknowledgement shape."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            captured: dict[str, object] = {}

            def open_request(request: object, timeout: float) -> _CompletionResponse:
                captured["url"] = request.full_url
                captured["authorization"] = request.get_header("Authorization")
                captured["body"] = request.data
                captured["timeout"] = timeout
                return _CompletionResponse()

            command = {"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed", "checksRun": 3}, "scanResult": {"passed": True, "summary": "scans passed", "checksRun": 3}}
            _AUTHORING.complete_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), command, open_request)
            self.assertEqual(captured["url"], "http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime/skill-authoring-validations:complete")
            self.assertEqual(captured["authorization"], "Bearer projected-token")
            self.assertEqual(captured["body"], b'{"validationId":"workload-1","outcome":"succeeded","testReport":{"passed":true,"summary":"checks passed","checksRun":3},"scanResult":{"passed":true,"summary":"scans passed","checksRun":3}}')
            self.assertEqual(captured["timeout"], 10.0)

    def test_refuses_unbounded_completion_evidence_or_a_noncanonical_authority_reply(self) -> None:
        """The worker neither sends raw validator output nor turns an ambiguous terminal reply into success."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            command = {"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed\nraw output", "checksRun": 3}, "scanResult": {"passed": True, "summary": "scans passed", "checksRun": 3}}
            with self.assertRaisesRegex(RuntimeError, "command is invalid"):
                _AUTHORING.complete_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), command)
            failed = {"validationId": "workload-1", "outcome": "failed", "failureCode": "validator_unavailable"}
            with self.assertRaisesRegex(RuntimeError, "completion was rejected"):
                _AUTHORING.complete_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), failed, lambda request, timeout: _CompletionResponse(b'{"completed":false}'))

    def test_rejects_oversized_authority_replies_and_boolean_check_counts(self) -> None:
        """The completion exchange keeps both incoming authority data and outgoing evidence within their exact bounds."""
        with tempfile.TemporaryDirectory() as raw:
            directory = pathlib.Path(raw)
            succeeded = {"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed", "checksRun": 3}, "scanResult": {"passed": True, "summary": "scans passed", "checksRun": 3}}
            with self.assertRaisesRegex(RuntimeError, "response exceeded"):
                _AUTHORING.complete_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), succeeded, lambda request, timeout: _CompletionResponse(b"x" * 4097))
            invalid = {"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed", "checksRun": True}, "scanResult": {"passed": True, "summary": "scans passed", "checksRun": 3}}
            with self.assertRaisesRegex(RuntimeError, "command is invalid"):
                _AUTHORING.complete_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", self._token(directory), invalid)

    def test_runs_one_server_selected_bundle_to_a_bounded_success_and_erases_its_workspace(self) -> None:
        """The lifecycle joins only the fixed worker primitives and leaves no candidate bytes behind."""
        captured: dict[str, object] = {}

        def download(base_url: str, workload_id: str, token_path: str, destination: pathlib.Path) -> pathlib.Path:
            captured["download"] = (base_url, workload_id, token_path)
            destination.write_bytes(b"bundle")
            return destination

        def extract(archive: pathlib.Path, destination: pathlib.Path) -> pathlib.Path:
            destination.mkdir()
            (destination / "SKILL.md").write_text("# Example", encoding="utf-8")
            return destination

        def validate(destination: pathlib.Path) -> tuple[dict[str, object], dict[str, object]]:
            captured["workspace"] = destination.parent
            return ({"passed": True, "summary": "checks passed", "checksRun": 3}, {"passed": True, "summary": "scan passed", "checksRun": 3})

        def complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            captured["completion"] = (base_url, workload_id, token_path, command)

        result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", download, extract, validate, complete)
        self.assertEqual(result, 0)
        self.assertEqual(captured["download"], ("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token"))
        self.assertEqual(captured["completion"], ("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", {"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed", "checksRun": 3}, "scanResult": {"passed": True, "summary": "scan passed", "checksRun": 3}}))
        self.assertFalse(captured["workspace"].exists())

    def test_replaces_every_validator_failure_with_one_stable_terminal_code(self) -> None:
        """A failed archive check cannot leak its local reason or suppress the terminal transition."""
        completions: list[dict[str, object]] = []

        def unavailable(base_url: str, workload_id: str, token_path: str, destination: pathlib.Path) -> pathlib.Path:
            raise RuntimeError("candidate path and raw output must not cross the boundary")

        def complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            completions.append(command)

        result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", unavailable, _AUTHORING.extract_bundle, _AUTHORING.validate_bundle, complete)
        self.assertEqual(result, 1)
        self.assertEqual(completions, [{"validationId": "workload-1", "outcome": "failed", "failureCode": "offline_validation_failed"}])

    def test_main_bootstraps_before_it_can_run_the_authoring_lifecycle(self) -> None:
        """The image entrypoint cannot choose a workload or start validation before server acknowledgement."""
        with mock.patch.object(_AUTHORING.bootstrap, "_required_environment", side_effect=["http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "/token", "/reference"]), mock.patch.object(_AUTHORING.bootstrap, "acknowledge_authoring_validation", return_value="validation-1") as acknowledge, mock.patch.object(_AUTHORING, "run_authoring_workload", return_value=0) as run:
            self.assertEqual(_AUTHORING.main(), 0)
        acknowledge.assert_called_once_with("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "/token", "/reference")
        run.assert_called_once_with("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "validation-1", "/token")

    def test_reports_a_terminal_failure_when_the_ephemeral_workspace_cannot_be_created(self) -> None:
        """An acknowledged workload cannot be stranded by a local disk or permission failure."""
        completions: list[dict[str, object]] = []

        def complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            completions.append(command)

        with mock.patch.object(_AUTHORING.tempfile, "mkdtemp", side_effect=OSError("disk unavailable")):
            result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", complete=complete)
        self.assertEqual(result, 1)
        self.assertEqual(completions, [{"validationId": "workload-1", "outcome": "failed", "failureCode": "offline_validation_failed"}])

    def test_does_not_replace_an_uncertain_success_with_a_contradictory_failure(self) -> None:
        """A dropped acknowledgement after durable success can fail the Job but must not change its outcome."""
        completions: list[dict[str, object]] = []

        def download(base_url: str, workload_id: str, token_path: str, destination: pathlib.Path) -> pathlib.Path:
            destination.write_bytes(b"bundle")
            return destination

        def extract(archive: pathlib.Path, destination: pathlib.Path) -> pathlib.Path:
            destination.mkdir()
            return destination

        def validate(destination: pathlib.Path) -> tuple[dict[str, object], dict[str, object]]:
            return ({"passed": True, "summary": "checks passed", "checksRun": 3}, {"passed": True, "summary": "scan passed", "checksRun": 3})

        def uncertain_complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            completions.append(command)
            raise RuntimeError("connection closed after server commit")

        with mock.patch.object(_AUTHORING, "_write_event") as write_event:
            result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", download, extract, validate, uncertain_complete)
        self.assertEqual(result, 1)
        self.assertEqual(completions, [{"validationId": "workload-1", "outcome": "succeeded", "testReport": {"passed": True, "summary": "checks passed", "checksRun": 3}, "scanResult": {"passed": True, "summary": "scan passed", "checksRun": 3}}] * 3)
        write_event.assert_called_once_with("completion_uncertain")

    def test_erases_a_candidate_tree_even_when_its_checks_remove_owner_directory_access(self) -> None:
        """Candidate tests cannot turn a successful result into residual `/tmp` source bytes by chmodding its workspace root."""
        captured: dict[str, pathlib.Path] = {}

        def download(base_url: str, workload_id: str, token_path: str, destination: pathlib.Path) -> pathlib.Path:
            destination.write_bytes(b"bundle")
            return destination

        def extract(archive: pathlib.Path, destination: pathlib.Path) -> pathlib.Path:
            destination.mkdir()
            (destination / "candidate.py").write_text("pass", encoding="utf-8")
            captured["workspace"] = destination.parent
            destination.parent.chmod(0)
            return destination

        def validate(destination: pathlib.Path) -> tuple[dict[str, object], dict[str, object]]:
            return ({"passed": True, "summary": "checks passed", "checksRun": 3}, {"passed": True, "summary": "scan passed", "checksRun": 3})

        def complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            return None

        result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", download, extract, validate, complete)
        self.assertEqual(result, 0)
        self.assertFalse(captured["workspace"].exists())

    def test_retries_a_transient_failure_to_deliver_one_unchanged_terminal_outcome(self) -> None:
        """A momentary completion outage does not strand an acknowledged workload or alter its failure code."""
        completions: list[dict[str, object]] = []

        def unavailable(base_url: str, workload_id: str, token_path: str, destination: pathlib.Path) -> pathlib.Path:
            raise RuntimeError("validator unavailable")

        def eventually_complete(base_url: str, workload_id: str, token_path: str, command: dict[str, object]) -> None:
            completions.append(command)
            if len(completions) == 1:
                raise RuntimeError("temporary authority outage")

        result = _AUTHORING.run_authoring_workload("http://opencrane-server.silo.svc.cluster.local:8081/api/internal/agent-runtime", "workload-1", "/token", unavailable, _AUTHORING.extract_bundle, _AUTHORING.validate_bundle, eventually_complete)
        self.assertEqual(result, 1)
        self.assertEqual(completions, [{"validationId": "workload-1", "outcome": "failed", "failureCode": "offline_validation_failed"}] * 2)


if __name__ == "__main__":
    unittest.main()
