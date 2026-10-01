"""Check the receipt wire and credential binding without proxy dependencies."""

import hashlib
import hmac
import json
import unittest

from ..context import CONTRACT_HEADER, CONTRACT_VERSION, DEADLINE_HEADER, FENCE_HEADER, KEY_DOMAIN, MESSAGE_DOMAIN, NONCE_HEADER, capture_request, signed_receipt


class RequestContextTests(unittest.TestCase):
    def setUp(self):
        self.now = 1_800_000_000_000
        self.key = "sk-synthetic-attempt-key-not-a-credential"
        self.digest = hashlib.sha256(self.key.encode()).hexdigest()
        self.body = b'{"model":"synthetic"}'
        self.headers = [
            (b"authorization", f"Bearer {self.key}".encode()),
            (CONTRACT_HEADER.encode(), CONTRACT_VERSION.encode()),
            (NONCE_HEADER.encode(), b"a" * 64),
            (FENCE_HEADER.encode(), b"b" * 64),
            (DEADLINE_HEADER.encode(), str(self.now + 25_000).encode()),
        ]

    def capture(self, headers=None, key_hash=None, body=None):
        return capture_request(self.headers if headers is None else headers,
                               self.body if body is None else body,
                               self.digest if key_hash is None else key_hash, self.now)

    def test_domain_separated_mac_covers_every_field(self):
        proof = self.capture()
        self.assertIsNotNone(proof)
        body, mac = signed_receipt(proof, self.now + 1000)
        receipt = body["receipt"]
        self.assertEqual(receipt["requestBodySha256"], hashlib.sha256(self.body).hexdigest())
        derived = hmac.new(self.key.encode(), KEY_DOMAIN, hashlib.sha256).digest()
        canonical = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(mac, hmac.new(derived, MESSAGE_DOMAIN + canonical, hashlib.sha256).hexdigest())
        self.assertNotIn(self.key, repr(proof))
        self.assertNotIn(derived.hex(), repr(proof))
        for name, value in receipt.items():
            with self.subTest(field=name):
                altered = {**receipt, name: value + 1 if type(value) is int else value + "changed"}
                encoded = json.dumps(altered, sort_keys=True, separators=(",", ":")).encode()
                self.assertNotEqual(mac, hmac.new(derived, MESSAGE_DOMAIN + encoded, hashlib.sha256).hexdigest())

    def test_duplicate_or_missing_headers_never_bind(self):
        for index, (name, value) in enumerate(self.headers):
            with self.subTest(name=name):
                self.assertIsNone(self.capture(self.headers[:index] + self.headers[index + 1:]))
                self.assertIsNone(self.capture(self.headers + [(name.upper(), value)]))

    def test_malformed_or_unbounded_coordinates_never_bind(self):
        replacements = (
            (CONTRACT_HEADER, b"unknown"), (NONCE_HEADER, b"A" * 64),
            (NONCE_HEADER, b"a" * 63), (FENCE_HEADER, b"invalid"),
            (DEADLINE_HEADER, b"0"), (DEADLINE_HEADER, str(self.now).encode()),
            (DEADLINE_HEADER, str(self.now + 25_001).encode()),
            (DEADLINE_HEADER, b"0" + str(self.now + 1000).encode()),
            (DEADLINE_HEADER, b"9" * 100), ("authorization", b"Bearer other-key"),
        )
        for name, invalid in replacements:
            with self.subTest(name=name, invalid=invalid):
                headers = [(key, invalid if key == name.encode() else value) for key, value in self.headers]
                self.assertIsNone(self.capture(headers))
        self.assertIsNone(self.capture(key_hash="0" * 64))
        self.assertIsNone(self.capture(key_hash="unhashed"))
        self.assertIsNone(self.capture(body=b"x" * (1024 * 1024 + 1)))
