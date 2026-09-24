import { describe, expect, it } from "vitest";

import { KeyedConversationComputerReviewCredentialDeriver } from "../conversation-computer-review-credential";

const _KEY = Buffer.alloc(32, 7).toString("base64url");
const _OLDER_KEY = Buffer.alloc(32, 9).toString("base64url");
const _KEYRING = { currentKeyId: "k1", keys: { k1: _KEY } };
const _LEASE = { siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2 } };

/** Proves the review bearer is keyed, lease-specific, rotation-safe and unavailable without a server key. */
describe("KeyedConversationComputerReviewCredentialDeriver", function _Suite()
{
	it("returns the same secret for the same lease so retries stay stable", function _Stable()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(deriver.derive(_LEASE)).toBe(deriver.derive({ ..._LEASE }));
		expect(deriver.derive(_LEASE)).toMatch(/^[0-9a-f]{64}$/u);
		expect(deriver.bearer(_LEASE)).toBe(deriver.derive(_LEASE));
	});

	it("changes the secret with every coordinate and every key", function _Distinct()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		const base = deriver.derive(_LEASE);
		expect(deriver.derive({ ..._LEASE, lease: { ..._LEASE.lease, leaseGeneration: 3 } })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, lease: { ..._LEASE.lease, leaseId: "lease-2" } })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, computerId: "computer-2" })).not.toBe(base);
		expect(deriver.derive({ ..._LEASE, siloId: "silo-2" })).not.toBe(base);
		const otherKey = new KeyedConversationComputerReviewCredentialDeriver("k2", { k2: _OLDER_KEY });
		expect(otherKey.derive(_LEASE)).not.toBe(base);
	});

	it("keeps presenting the credential a live Pod holds after the current key rotates", function _RotationSafe()
	{
		const before = KeyedConversationComputerReviewCredentialDeriver.fromKeyring({ currentKeyId: "k1", keys: { k1: _KEY } });
		const held = before.derive(_LEASE);
		const after = KeyedConversationComputerReviewCredentialDeriver.fromKeyring({ currentKeyId: "k2", keys: { k1: _KEY, k2: _OLDER_KEY } });
		const presented = after.bearer(_LEASE).split(",");
		expect(presented).toHaveLength(2);
		expect(presented[0]).toBe(after.derive(_LEASE));
		expect(presented).toContain(held);
		expect(after.derive(_LEASE)).not.toBe(held);
		const retired = KeyedConversationComputerReviewCredentialDeriver.fromKeyring({ currentKeyId: "k2", keys: { k2: _OLDER_KEY } });
		expect(retired.bearer(_LEASE).split(",")).not.toContain(held);
	});

	it("never equals the public lease id or any unkeyed digest of it", function _NotDerivableFromLabels()
	{
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(deriver.derive(_LEASE)).not.toBe(_LEASE.lease.leaseId);
		expect(deriver.bearer(_LEASE)).not.toContain(_LEASE.lease.leaseId);
	});

	it("fails closed without a usable key or complete coordinates", function _FailsClosed()
	{
		expect(() => KeyedConversationComputerReviewCredentialDeriver.fromKeyring({ currentKeyId: "missing", keys: { k1: _KEY } })).toThrow("current keyring key");
		expect(() => new KeyedConversationComputerReviewCredentialDeriver("k1", { k1: Buffer.alloc(16, 1).toString("base64url") })).toThrow("256 bits");
		expect(() => new KeyedConversationComputerReviewCredentialDeriver("k1", { k1: _KEY, k0: Buffer.alloc(16, 1).toString("base64url") })).toThrow("256 bits");
		const deriver = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_KEYRING);
		expect(() => deriver.derive({ ..._LEASE, lease: { ..._LEASE.lease, leaseId: "" } })).toThrow("complete lease coordinates");
		expect(() => deriver.bearer({ ..._LEASE, lease: { ..._LEASE.lease, leaseGeneration: 0 } })).toThrow("complete lease coordinates");
	});
});
