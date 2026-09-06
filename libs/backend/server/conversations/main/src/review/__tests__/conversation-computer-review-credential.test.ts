import { describe, expect, it } from "vitest";

import { KeyedConversationComputerReviewCredentialDeriver } from "../conversation-computer-review-credential";

const _KEY = Buffer.alloc(32, 7).toString("base64url");
const _KEYRING = { currentKeyId: "k1", keys: { k1: _KEY } };
const _LEASE = { siloId: "silo-1", computerId: "computer-1", generation: 2, leaseId: "lease-1" };

/** Proves the review bearer is keyed, lease-specific and unavailable without the server key. */
describe("KeyedConversationComputerReviewCredentialDeriver", function _Suite()
{
	it("returns the same secret for the same lease so retries stay stable", function _Stable()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(deriver.derive(_LEASE)).toBe(deriver.derive({ ..._LEASE }));
		expect(deriver.derive(_LEASE)).toMatch(/^[0-9a-f]{64}$/u);
	});

	it("changes the secret with every coordinate and every key", function _Distinct()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		const base = deriver.derive(_LEASE);
		expect(deriver.derive({ ..._LEASE, generation: 3 })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, leaseId: "lease-2" })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, computerId: "computer-2" })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, siloId: "silo-2" })).not.toBe(base);
		const otherKey = new KeyedConversationComputerReviewCredentialDeriver(Buffer.alloc(32, 9));
		expect(otherKey.derive(_LEASE)).not.toBe(base);
	});

	it("never equals the public lease id or any unkeyed digest of it", function _NotDerivableFromLabels()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(deriver.derive(_LEASE)).not.toBe(_LEASE.leaseId);
		expect(deriver.derive(_LEASE)).not.toContain(_LEASE.leaseId);
	});

	it("fails closed without a usable key or complete coordinates", function _FailsClosed()
	{
		expect(() => KeyedConversationComputerReviewCredentialDeriver.fromKeyring({ currentKeyId: "missing", keys: { k1: _KEY } })).toThrow("current keyring key");
		expect(() => new KeyedConversationComputerReviewCredentialDeriver(Buffer.alloc(16, 1))).toThrow("256 bits");
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(() => deriver.derive({ ..._LEASE, leaseId: "" })).toThrow("complete lease coordinates");
		expect(() => deriver.derive({ ..._LEASE, generation: 0 })).toThrow("complete lease coordinates");
	});
});
