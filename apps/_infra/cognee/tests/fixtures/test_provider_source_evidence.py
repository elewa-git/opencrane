"""Prove candidate repair evidence cannot conceal changed upstream modules or artifacts."""

import argparse
import hashlib
import importlib.util
import json
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import source_repair_evidence as REPAIRS


class CandidateSourceDeclarationTest(unittest.TestCase):
    """Check the shipped candidate declaration before an image build reaches attestation."""

    def test_candidate_repairs_match_upstream_modules_and_image_profile(self) -> None:
        candidate = Path(__file__).resolve().parent.parent / "candidates" / "1.5.4"
        expected = json.loads((candidate / "expected-source-hashes.json").read_text())
        profile = json.loads((candidate / "profile.json").read_text())
        repairs = REPAIRS.validated_repairs(expected, profile)
        self.assertTrue(repairs)
        self.assertEqual(repairs, expected["repairs"])


class ProviderSourceEvidenceTest(unittest.TestCase):
    """Exercise repair validation and the complete attestation driver using synthetic files."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.repair_root = self.root / "repairs"
        self.repair_root.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(REPAIRS, "_REPAIR_ROOT", self.repair_root).start()
        self.module = "upstream.adapter"
        self.origin = self.root / "adapter.py"
        self.origin.write_bytes(b"candidate adapter bytes\n")
        self.patch_path = self.repair_root / "repair.patch"
        self.patch_path.write_bytes(b"synthetic patch artifact\n")
        self.receipt = self.repair_root / "receipt.json"
        self.repair = {
            "baseImageDigest": "sha256:" + "b" * 64,
            "preimageSha256": "a" * 64,
            "patchSha256": hashlib.sha256(self.patch_path.read_bytes()).hexdigest(),
            "postimageSha256": hashlib.sha256(self.origin.read_bytes()).hexdigest(),
            "patchPath": str(self.patch_path),
            "receiptPath": str(self.receipt),
        }
        self.expected = {
            "version": "test-version",
            "source": {"scope": "official-tag-source-with-explicit-candidate-repair"},
            "modules": {self.module: self.repair["preimageSha256"]},
            "repairs": {self.module: self.repair},
        }
        self.profile = {"image": {"linuxAmd64Digest": self.repair["baseImageDigest"]}}
        self._write_receipt()

    def _write_receipt(self) -> None:
        """Write the exact receipt shape produced by the candidate build."""
        self.receipt.write_text(json.dumps({"module": self.module, **self.repair}))

    def _verify(self) -> dict:
        """Validate both declared identity and the corresponding actual artifact bytes."""
        REPAIRS.validated_repairs(self.expected, self.profile)
        return REPAIRS.verify_repair(
            self.module, self.origin, hashlib.sha256(self.origin.read_bytes()).hexdigest(),
            self.repair,
        )

    def _run_driver(self, origins: dict[str, Path]) -> dict:
        """Run main without installing Cognee or contacting any provider."""
        spec = importlib.util.spec_from_file_location(
            "candidate_source_driver", Path(__file__).with_name("source_evidence.py")
        )
        if spec is None or spec.loader is None:
            raise AssertionError("Source evidence driver could not be loaded")
        module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"cognee": types.SimpleNamespace(__version__="test-version")}):
            spec.loader.exec_module(module)
        expected_path = self.root / "expected.json"
        profile_path = self.root / "profile.json"
        output_path = self.root / "source-evidence.json"
        expected_path.write_text(json.dumps(self.expected))
        profile_path.write_text(json.dumps(self.profile))
        arguments = argparse.Namespace(
            expected=str(expected_path), profile=str(profile_path), output=str(output_path)
        )
        with patch.object(module, "_arguments", return_value=arguments), \
                patch.object(module, "_module_path", side_effect=origins.__getitem__), \
                patch("builtins.print"):
            module.main()
        return json.loads(output_path.read_text())

    def test_retains_upstream_preimage_and_verified_runtime_repair(self) -> None:
        result = self._run_driver({self.module: self.origin})
        self.assertEqual(self.expected["modules"][self.module], "a" * 64)
        self.assertEqual(result["modules"][self.module]["sha256"], self.repair["postimageSha256"])
        self.assertEqual(result["repairs"][self.module]["preimageSha256"], "a" * 64)
        self.assertTrue(result["repairs"][self.module]["verified"])

    def test_added_module_requires_explicit_absent_preimage_and_is_attested(self) -> None:
        self.expected["modules"] = {}
        self.repair["preimageSha256"] = None
        self._write_receipt()
        result = self._run_driver({self.module: self.origin})
        self.assertIsNone(result["repairs"][self.module]["preimageSha256"])
        self.assertIn(self.module, result["modules"])

    def test_unknown_module_cannot_claim_an_upstream_preimage(self) -> None:
        self.expected["modules"] = {}
        with self.assertRaisesRegex(AssertionError, "absent preimage"):
            self._verify()

    def test_upstream_module_cannot_claim_absence(self) -> None:
        self.repair["preimageSha256"] = None
        with self.assertRaisesRegex(AssertionError, "upstream preimage"):
            self._verify()

    def test_repair_cannot_replace_another_upstream_module_hash(self) -> None:
        unchanged = self.root / "unchanged.py"
        unchanged.write_bytes(b"unexpected modification\n")
        self.expected["modules"]["upstream.unchanged"] = "c" * 64
        with self.assertRaisesRegex(AssertionError, "Cognee source differs for upstream.unchanged"):
            self._run_driver({self.module: self.origin, "upstream.unchanged": unchanged})

    def test_wrong_profile_base_is_rejected(self) -> None:
        self.profile["image"]["linuxAmd64Digest"] = "sha256:" + "c" * 64
        with self.assertRaisesRegex(AssertionError, "base differs"):
            self._verify()

    def test_declaration_failure_retains_machine_readable_repair_evidence(self) -> None:
        self.profile["image"]["linuxAmd64Digest"] = "sha256:" + "c" * 64
        with self.assertRaisesRegex(AssertionError, "base differs"):
            self._run_driver({self.module: self.origin})
        evidence = json.loads((self.root / "source-evidence.json").read_text())
        self.assertEqual(evidence["declaredRepairs"][self.module], self.repair)
        self.assertEqual(evidence["profileBaseImageDigest"], self.profile["image"]["linuxAmd64Digest"])
        self.assertIn("base differs", evidence["mismatches"][0])
        self.assertEqual(evidence["repairs"], {})

    def test_repair_requires_a_profile(self) -> None:
        with self.assertRaisesRegex(AssertionError, "image profile"):
            REPAIRS.validated_repairs(self.expected, None)

    def test_unchanged_provider_needs_no_repair_profile(self) -> None:
        self.expected.pop("repairs")
        self.assertEqual(REPAIRS.validated_repairs(self.expected, None), {})

    def test_repaired_provider_requires_the_admitted_repair_scope(self) -> None:
        for source in ({}, {"scope": "official-tag-source-expectations"}, {"scope": "arbitrary-claim"}):
            with self.subTest(source=source):
                self.expected["source"] = source
                with self.assertRaisesRegex(AssertionError, "admitted candidate repair scope"):
                    self._verify()

    def test_receipt_rejects_missing_or_extra_fields(self) -> None:
        for invalid in ({"module": self.module}, {"module": self.module, **self.repair, "extra": True}):
            with self.subTest(invalid=invalid):
                self.receipt.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(AssertionError, "receipt differs"):
                    self._verify()

    def test_patch_and_runtime_changes_are_rejected(self) -> None:
        self.patch_path.write_bytes(b"changed patch\n")
        with self.assertRaisesRegex(AssertionError, "patch digest"):
            self._verify()
        self.patch_path.write_bytes(b"synthetic patch artifact\n")
        self.origin.write_bytes(b"changed module\n")
        with self.assertRaisesRegex(AssertionError, "postimage"):
            self._verify()

    def test_repair_artifact_must_stay_inside_its_directory(self) -> None:
        outside = self.root / "outside.patch"
        outside.write_bytes(self.patch_path.read_bytes())
        self.repair["patchPath"] = str(outside)
        self._write_receipt()
        with self.assertRaisesRegex(AssertionError, "escaped"):
            self._verify()

    def test_repair_artifact_cannot_be_a_symlink(self) -> None:
        link = self.repair_root / "link.patch"
        link.symlink_to(self.patch_path)
        self.repair["patchPath"] = str(link)
        self._write_receipt()
        with self.assertRaisesRegex(AssertionError, "regular absolute file"):
            self._verify()

    def test_patch_and_module_cannot_be_hardlinks_to_the_same_file(self) -> None:
        self.patch_path.unlink()
        os.link(self.origin, self.patch_path)
        with self.assertRaisesRegex(AssertionError, "distinct files"):
            self._verify()


if __name__ == "__main__":
    unittest.main()
