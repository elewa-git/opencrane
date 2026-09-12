#!/usr/bin/env python3
"""Verify the candidate repair patch and its cross-process file lock."""

import asyncio
import hashlib
import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
PATCH_DIRECTORY = (
    REPOSITORY_ROOT / "apps/_infra/cognee/tests/candidates/1.5.4/patches"
)
APPLIER_PATH = PATCH_DIRECTORY / "apply-source-patch.py"
APPLIER_SPEC = importlib.util.spec_from_file_location("candidate_source_patch", APPLIER_PATH)
if APPLIER_SPEC is None or APPLIER_SPEC.loader is None:
    raise RuntimeError("Unable to load the candidate source patch helper")
APPLIER = importlib.util.module_from_spec(APPLIER_SPEC)
APPLIER_SPEC.loader.exec_module(APPLIER)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _managed_lock_source() -> str:
    patch = (PATCH_DIRECTORY / "managed-data-file-lock.patch").read_text(encoding="utf-8")
    source = APPLIER._apply_unified_patch("", patch)
    expected = "c3fbada36b40460f67832da43bf04b9d7e7ce2f56ed81aa01a0fc2b831fd51e7"
    if _sha256(source.encode("utf-8")) != expected:
        raise AssertionError("Managed lock patch did not produce its declared postimage")
    return source.replace(
        "from cognee.infrastructure.files.storage import get_storage_config",
        "def get_storage_config():\n"
        "    return {'data_root_directory': os.environ['DATA_ROOT_DIRECTORY']}",
    )


def _load_managed_lock() -> types.ModuleType:
    module = types.ModuleType("candidate_managed_data_file_lock")
    exec(compile(_managed_lock_source(), "managed_data_file_lock.py", "exec"), module.__dict__)
    return module


class CandidatePatch154Test(unittest.TestCase):
    def test_patch_applier_rejects_context_drift(self) -> None:
        patch = "--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-old\n+new\n"
        self.assertEqual(APPLIER._apply_unified_patch("old\n", patch), "new\n")
        with self.assertRaisesRegex(ValueError, "context does not match"):
            APPLIER._apply_unified_patch("different\n", patch)

    def test_patch_cli_rejects_wrong_preimage_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "example.py"
            patch_path = root / "example.patch"
            receipt = root / "receipt.json"
            source.write_text("old\n", encoding="utf-8")
            patch_path.write_text(
                "--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-old\n+new\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(APPLIER_PATH),
                    "--source",
                    str(source),
                    "--patch",
                    str(patch_path),
                    "--receipt",
                    str(receipt),
                    "--module",
                    "example",
                    "--base-image-digest",
                    "sha256:" + "1" * 64,
                    "--preimage-sha256",
                    "0" * 64,
                    "--patch-sha256",
                    _sha256(patch_path.read_bytes()),
                    "--postimage-sha256",
                    _sha256(b"new\n"),
                ],
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_text(encoding="utf-8"), "old\n")
            self.assertFalse(receipt.exists())

    def test_patch_cli_rejects_occupied_absent_preimage_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "addition.py"
            patch_path = root / "addition.patch"
            receipt = root / "receipt.json"
            source.write_text("occupied\n", encoding="utf-8")
            patch_path.write_text(
                "--- /dev/null\n+++ b/addition.py\n@@ -0,0 +1 @@\n+created\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(APPLIER_PATH),
                    "--source",
                    str(source),
                    "--patch",
                    str(patch_path),
                    "--receipt",
                    str(receipt),
                    "--module",
                    "addition",
                    "--base-image-digest",
                    "sha256:" + "1" * 64,
                    "--preimage-absent",
                    "--patch-sha256",
                    _sha256(patch_path.read_bytes()),
                    "--postimage-sha256",
                    _sha256(b"created\n"),
                ],
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_text(encoding="utf-8"), "occupied\n")
            self.assertFalse(receipt.exists())

    def test_same_task_reenters_while_child_task_contends(self) -> None:
        module = _load_managed_lock()

        async def exercise() -> None:
            async with module.managed_data_file_lock(timeout_seconds=0.5):
                async with module.managed_data_file_lock(timeout_seconds=0.5):
                    pass

                async def contend() -> None:
                    async with module.managed_data_file_lock(timeout_seconds=0.1):
                        raise AssertionError("Child task bypassed the held kernel lock")

                with self.assertRaisesRegex(TimeoutError, "timed out"):
                    await asyncio.create_task(contend())

            async with module.managed_data_file_lock(timeout_seconds=0.5):
                pass

        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory) / "data"
            data_root.mkdir()
            with mock.patch.dict(
                os.environ, {"DATA_ROOT_DIRECTORY": str(data_root)}
            ):
                asyncio.run(exercise())

    def test_competing_process_waits_for_the_same_root_lock(self) -> None:
        module = _load_managed_lock()

        async def exercise(runtime_path: Path, data_root: Path) -> None:
            runner = (
                "import asyncio, runpy, sys\n"
                "values = runpy.run_path(sys.argv[1])\n"
                "async def attempt():\n"
                "    try:\n"
                "        async with values['managed_data_file_lock'](0.1):\n"
                "            print('acquired')\n"
                "    except TimeoutError:\n"
                "        print('timeout')\n"
                "asyncio.run(attempt())\n"
            )
            async with module.managed_data_file_lock(timeout_seconds=0.5):
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    runner,
                    str(runtime_path),
                    env={**os.environ, "DATA_ROOT_DIRECTORY": str(data_root)},
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                stdout, stderr = await process.communicate()
            self.assertEqual(process.returncode, 0, stderr.decode("utf-8"))
            self.assertEqual(stdout.decode("utf-8").strip(), "timeout")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_root = root / "data"
            data_root.mkdir()
            runtime_path = root / "managed_data_file_lock.py"
            runtime_path.write_text(_managed_lock_source(), encoding="utf-8")
            with mock.patch.dict(
                os.environ, {"DATA_ROOT_DIRECTORY": str(data_root)}
            ):
                asyncio.run(exercise(runtime_path, data_root))

    def test_process_exit_releases_the_same_root_lock(self) -> None:
        module = _load_managed_lock()

        async def exercise(runtime_path: Path, data_root: Path) -> None:
            holder_runner = (
                "import asyncio, runpy, sys\n"
                "values = runpy.run_path(sys.argv[1])\n"
                "async def hold():\n"
                "    async with values['managed_data_file_lock'](1):\n"
                "        print('acquired', flush=True)\n"
                "        await asyncio.Event().wait()\n"
                "asyncio.run(hold())\n"
            )
            holder = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                holder_runner,
                str(runtime_path),
                env={**os.environ, "DATA_ROOT_DIRECTORY": str(data_root)},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            try:
                if holder.stdout is None:
                    raise AssertionError("Synthetic lock holder has no output pipe")
                signal = await asyncio.wait_for(holder.stdout.readline(), timeout=2)
                self.assertEqual(signal, b"acquired\n")
                holder.terminate()
                await asyncio.wait_for(holder.wait(), timeout=2)
            finally:
                if holder.returncode is None:
                    holder.kill()
                    await asyncio.wait_for(holder.wait(), timeout=1)

            async def contend_after_exit() -> None:
                async with module.managed_data_file_lock(timeout_seconds=0.5):
                    pass

            await asyncio.wait_for(
                asyncio.create_task(contend_after_exit()), timeout=1
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_root = root / "data"
            data_root.mkdir()
            runtime_path = root / "managed_data_file_lock.py"
            runtime_path.write_text(_managed_lock_source(), encoding="utf-8")
            with mock.patch.dict(
                os.environ, {"DATA_ROOT_DIRECTORY": str(data_root)}
            ):
                asyncio.run(exercise(runtime_path, data_root))

    def test_cancelled_holder_releases_descriptor(self) -> None:
        module = _load_managed_lock()

        async def exercise() -> None:
            entered = asyncio.Event()
            wait_forever = asyncio.Event()

            async def hold() -> None:
                async with module.managed_data_file_lock(timeout_seconds=0.5):
                    entered.set()
                    await wait_forever.wait()

            holder = asyncio.create_task(hold())
            await entered.wait()
            holder.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await holder
            async with module.managed_data_file_lock(timeout_seconds=0.5):
                pass

        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory) / "data"
            data_root.mkdir()
            with mock.patch.dict(
                os.environ, {"DATA_ROOT_DIRECTORY": str(data_root)}
            ):
                asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
