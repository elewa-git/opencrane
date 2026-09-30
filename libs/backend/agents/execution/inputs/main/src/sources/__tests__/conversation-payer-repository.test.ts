import { describe, expect, it, vi } from "vitest";

import { PrismaConversationContextRepository } from "../prisma-conversation-context-repository";

const _Digests = {
	decision: `sha256:${"1".repeat(64)}`,
	policy: `sha256:${"2".repeat(64)}`,
	effective: `sha256:${"3".repeat(64)}`,
} as const;

/** Creates the repository over a transaction double and one configurable conversation row. */
function _Fixture(row: unknown)
{
	const findFirst = vi.fn().mockResolvedValue(row);
	const transaction = { conversation: { findFirst } };
	const repository = new PrismaConversationContextRepository(transaction as never, { read: vi.fn() });
	const command = { siloId: "silo-1", conversationId: "conversation-1" } as never;
	return { findFirst, repository, command };
}

describe("PrismaConversationContextRepository.payer", function _Suite()
{
	it("returns the exact managed payer tuple and query boundary", async function _ReadsManagedPayer()
	{
		const fixture = _Fixture({ payingGroupId: "group-1", payingGroupAuthorizationDecisionDigest: _Digests.decision, payingGroupAuthorizationPolicyRevisionHash: _Digests.policy, payingGroupEffectiveAuthorizationDigest: _Digests.effective });
		await expect(fixture.repository.payer(fixture.command)).resolves.toEqual({ payingGroupId: "group-1", authorization: { decisionDigest: _Digests.decision, policyRevisionHash: _Digests.policy, effectiveAuthorizationDigest: _Digests.effective } });
		expect(fixture.findFirst).toHaveBeenCalledWith({ where: { id: "conversation-1", siloId: "silo-1" }, select: { payingGroupId: true, payingGroupAuthorizationDecisionDigest: true, payingGroupAuthorizationPolicyRevisionHash: true, payingGroupEffectiveAuthorizationDigest: true } });
	});

	it("returns null for non-conversational work and does not query a conversation", async function _ReadsNonConversationalNull()
	{
		const fixture = _Fixture({ payingGroupId: "unexpected-group" });
		await expect(fixture.repository.payer({ siloId: "silo-1", conversationId: null } as never)).resolves.toBeNull();
		expect(fixture.findFirst).not.toHaveBeenCalled();
	});

	it.each([
		{ payingGroupId: null, payingGroupAuthorizationDecisionDigest: null, payingGroupAuthorizationPolicyRevisionHash: null, payingGroupEffectiveAuthorizationDigest: null },
		{ payingGroupId: "group-1", payingGroupAuthorizationDecisionDigest: _Digests.decision, payingGroupAuthorizationPolicyRevisionHash: null, payingGroupEffectiveAuthorizationDigest: _Digests.effective },
		{ payingGroupId: "group-1", payingGroupAuthorizationDecisionDigest: "not-a-digest", payingGroupAuthorizationPolicyRevisionHash: _Digests.policy, payingGroupEffectiveAuthorizationDigest: _Digests.effective },
		{ payingGroupId: " ", payingGroupAuthorizationDecisionDigest: _Digests.decision, payingGroupAuthorizationPolicyRevisionHash: _Digests.policy, payingGroupEffectiveAuthorizationDigest: _Digests.effective },
	])("returns the safe result for null, partial, or malformed payer evidence: %j", async function _RejectsInvalidPayer(row)
	{
		const fixture = _Fixture(row);
		const expected = Object.values(row).every(value => value === null) ? null : undefined;
		await expect(fixture.repository.payer(fixture.command)).resolves.toBe(expected);
	});

	it("returns undefined when the conversation row is missing", async function _RejectsMissingConversation()
	{
		const fixture = _Fixture(null);
		await expect(fixture.repository.payer(fixture.command)).resolves.toBeUndefined();
	});
});
