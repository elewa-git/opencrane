import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerCredentialPreparationOutcomes as Outcomes, ConversationComputerCredentialStates as States, type ConversationComputerCredentialCustody } from "../../db/conversation-computer-credential-persistence.types";
import { _AssertCredentialReusable, _CredentialRequiresRevocation, _PrepareExistingCredential } from "../conversation-computer-credential-state";

const _NOW = Date.parse("2026-09-07T00:00:00.000Z");
const _INPUT = { bootstrapId: "bootstrap-1", keyAlias: "attempt-1", modelAlias: "model-1", computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1 }, expirySeconds: 300, notAfter: new Date(_NOW + 600_000).toISOString(), maxBudgetUsd: 0.1 };

beforeEach(function _Clock() { vi.spyOn(Date, "now").mockReturnValue(_NOW); });
afterEach(function _RestoreClock() { vi.restoreAllMocks(); });

function _Row(state: States): ConversationComputerCredentialCustody
{
	return { bootstrapId: _INPUT.bootstrapId, siloId: "silo-1", conversationId: "conversation-1", keyAlias: "attempt-1", modelAlias: "model-1", state, claimFence: "original-fence", claimExpiresAt: new Date(_NOW + 30_000), expiresAt: new Date(_NOW + 300_000), keyId: "key-1", nonce: Buffer.from("nonce"), authTag: Buffer.from("tag"), ciphertext: Buffer.from("secret"), ciphertextDigest: "cipher-digest", credentialDigest: "key-digest" };
}

describe("credential State × Event decisions", function _StateEvents()
{
	it.each([
		[States.Custodied, Outcomes.Custody, false, true],
		[States.Ready, Outcomes.Ready, true, true],
		[States.AliasCleanup, Outcomes.AliasCleanup, false, true],
		[States.Revoking, Outcomes.Expired, false, true],
	] as const)("keeps %s issuance, reuse and revocation with its state owner", function _ExistingState(state, outcome, reusable, requiresRevocation)
	{
		const row = _Row(state);
		expect(_PrepareExistingCredential(row, _INPUT)).toEqual({ outcome, row });
		if (reusable)
			expect(function _Reuse() { _AssertCredentialReusable(row); }).not.toThrow();
		else
			expect(function _Reuse() { _AssertCredentialReusable(row); }).toThrow("not ready");
		expect(_CredentialRequiresRevocation(row)).toBe(requiresRevocation);
	});

	it("refuses every command that would race a live Pending provider call", function _LivePending()
	{
		const row = _Row(States.Pending);
		expect(function _Issue() { _PrepareExistingCredential(row, _INPUT); }).toThrow("already in progress");
		expect(function _Reuse() { _AssertCredentialReusable(row); }).toThrow("not ready");
		expect(function _Revoke() { _CredentialRequiresRevocation(row); }).toThrow("still in progress");
	});

	it("routes an expired Pending claim to alias cleanup without granting another mint", function _ExpiredPending()
	{
		const row = { ..._Row(States.Pending), claimExpiresAt: new Date(_NOW) };
		expect(_PrepareExistingCredential(row, _INPUT)).toEqual({ outcome: Outcomes.AliasCleanup, row });
		expect(function _Reuse() { _AssertCredentialReusable(row); }).toThrow("not ready");
		expect(_CredentialRequiresRevocation(row)).toBe(true);
	});

	it("keeps Revoked terminal for issue, reuse and repeated cleanup", function _Revoked()
	{
		const row = _Row(States.Revoked);
		expect(function _Issue() { _PrepareExistingCredential(row, _INPUT); }).toThrow("already revoked");
		expect(function _Reuse() { _AssertCredentialReusable(row); }).toThrow("not ready");
		expect(_CredentialRequiresRevocation(row)).toBe(false);
	});

	it.each([States.Ready, States.Custodied])("requires complete and unexpired %s ciphertext", function _CustodyGuards(state)
	{
		const row = _Row(state);
		for (const expiresAt of [new Date(_NOW), new Date(_NOW + 700_000)])
			expect(_PrepareExistingCredential({ ...row, expiresAt }, _INPUT).outcome).toBe(Outcomes.Expired);
		expect(function _Incomplete() { _PrepareExistingCredential({ ...row, ciphertext: null }, _INPUT); }).toThrow("missing encrypted custody");
	});

	it.each(["unknown", "__proto__"])("refuses unknown stored state %s", function _Unknown(state)
	{
		const row = _Row(state as States);
		expect(function _Issue() { _PrepareExistingCredential(row, _INPUT); }).toThrow("unsupported custody state");
		expect(function _Reuse() { _AssertCredentialReusable(row); }).toThrow("not ready");
		expect(function _Revoke() { _CredentialRequiresRevocation(row); }).toThrow("unsupported custody state");
	});
});
