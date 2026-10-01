"""Exercise build-time source identity checks without installing or running a vendor package."""

import hashlib
from pathlib import Path
import runpy
import shlex
import tempfile
import unittest
from unittest.mock import patch


INSTALLER = runpy.run_path(str(Path(__file__).parents[1] / "deploy/install-bindings.py"))
REPLACE = INSTALLER["replace_verified"]


class BindingInstallationTest(unittest.TestCase):
    def test_image_copies_every_module_required_by_the_proof_suite(self):
        """Expand the image's real COPY rules so omitted proof modules fail before Docker runs."""
        app = Path(__file__).parents[1]
        workspace = app.parents[2]
        installed = set()
        prefix = "/opt/opencrane/qualified-model-proxy/"
        for line in (app / "deploy/Dockerfile").read_text().splitlines():
            if not line.startswith("COPY "):
                continue
            _, *options = shlex.split(line)
            source, destination = options[-2:]
            if not destination.startswith(prefix) or not destination.endswith("/"):
                continue
            for file in workspace.glob(source):
                if file.is_file() and file.suffix == ".py":
                    installed.add((destination.removeprefix(prefix) + file.stem).replace("/", "."))
        for module in ("context", "limiter", "processor", "registration", "tests.test_context", "tests.test_limiter", "tests.test_processor", "tests.test_registration"):
            self.assertIn("opencrane_litellm_proxy." + module, installed)

    def setUp(self):
        self.source = b"from vendor import Processor\n"
        self.after = b"from owned import Processor\n"
        self.binding = {
            "before": hashlib.sha256(self.source).hexdigest(),
            "after": hashlib.sha256(self.after).hexdigest(),
            "replacements": [("from vendor", "from owned")],
        }

    def test_changes_exact_reviewed_bytes(self):
        self.assertEqual(REPLACE(self.source, self.binding), self.after)

    def test_rejects_changed_preimage(self):
        with self.assertRaisesRegex(ValueError, "preimage"):
            REPLACE(self.source + b"# changed\n", self.binding)

    def test_rejects_missing_replacement(self):
        self.binding["replacements"] = [("missing", "replacement")]
        with self.assertRaisesRegex(ValueError, "exactly once"):
            REPLACE(self.source, self.binding)

    def test_rejects_ambiguous_replacement(self):
        source = self.source * 2
        self.binding["before"] = hashlib.sha256(source).hexdigest()
        with self.assertRaisesRegex(ValueError, "exactly once"):
            REPLACE(source, self.binding)

    def test_rejects_changed_postimage(self):
        self.binding["after"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "postimage"):
            REPLACE(self.source, self.binding)

    def test_rejects_repeat_installation(self):
        with self.assertRaisesRegex(ValueError, "preimage"):
            REPLACE(self.after, self.binding)

    def test_installs_all_bindings_and_records_postimages(self):
        with tempfile.TemporaryDirectory(prefix="opencrane-binding-test-") as directory:
            root = Path(directory)
            (root / "first.py").write_bytes(self.source)
            (root / "second.py").write_bytes(self.source)
            receipt = root / "receipt.json"
            bindings = {"first.py": self.binding, "second.py": self.binding}
            with patch.dict(INSTALLER["install_bindings"].__globals__, BINDINGS=bindings):
                INSTALLER["install_bindings"](root, receipt)
            self.assertEqual((root / "first.py").read_bytes(), self.after)
            self.assertEqual((root / "second.py").read_bytes(), self.after)
            self.assertEqual(INSTALLER["json"].loads(receipt.read_text()), {
                "schema": 1, "bindings": {name: self.binding["after"] for name in bindings},
            })

    def test_rejects_second_preimage_before_changing_first(self):
        with tempfile.TemporaryDirectory(prefix="opencrane-binding-test-") as directory:
            root = Path(directory)
            (root / "first.py").write_bytes(self.source)
            (root / "second.py").write_bytes(b"unreviewed")
            receipt = root / "receipt.json"
            with patch.dict(INSTALLER["install_bindings"].__globals__, BINDINGS={"first.py": self.binding, "second.py": self.binding}):
                with self.assertRaisesRegex(ValueError, "preimage"):
                    INSTALLER["install_bindings"](root, receipt)
            self.assertEqual((root / "first.py").read_bytes(), self.source)
            self.assertFalse(receipt.exists())

    def test_rejects_symlink_source(self):
        with tempfile.TemporaryDirectory(prefix="opencrane-binding-test-") as directory:
            root = Path(directory)
            (root / "real.py").write_bytes(self.source)
            (root / "source.py").symlink_to(root / "real.py")
            with patch.dict(INSTALLER["install_bindings"].__globals__, BINDINGS={"source.py": self.binding}):
                with self.assertRaisesRegex(ValueError, "regular source"):
                    INSTALLER["install_bindings"](root, root / "receipt.json")


if __name__ == "__main__":
    unittest.main()
