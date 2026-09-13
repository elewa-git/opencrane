import { describe, expect, it } from "vitest";

import { ___ConversationToolProposalSchema } from "../conversation-tool-proposal.validator";

/** Valid private selection contains no principal, lease, approval or result authority. */
const _PROPOSAL = { bootstrapId: "b1f5a60b-22d8-4dce-b41f-8da167ea0554", toolRevisionId: "tool-revision-1", arguments: { query: "record", limit: 1 } };

describe("private conversation tool proposal schema", function _Suite()
{
	it("accepts only the complete bounded selection", function _Valid()
	{
		expect(___ConversationToolProposalSchema.parse(_PROPOSAL)).toEqual(_PROPOSAL);
	});
	it.each(["principalId", "runId", "attempt", "lease", "approved", "recoveryMode", "result"])("refuses caller-supplied %s", function _NoAuthority(field)
	{
		expect(___ConversationToolProposalSchema.safeParse({ ..._PROPOSAL, [field]: "forged" }).success).toBe(false);
	});
	it.each([null, [], "query", { value: Number.NaN }, { value: undefined }, { query: "\ud800" }, { ["\udfff"]: "invalid key" }, { query: "x".repeat(65_536) }])("refuses invalid or oversized arguments", function _InvalidArguments(argumentsValue)
	{
		expect(___ConversationToolProposalSchema.safeParse({ ..._PROPOSAL, arguments: argumentsValue }).success).toBe(false);
	});
	it("rejects excessive depth and cycles before canonicalization", function _Depth()
	{
		let nested: unknown = "end";
		for (let depth = 0; depth < 18; depth++)
			nested = { nested };
		expect(___ConversationToolProposalSchema.safeParse({ ..._PROPOSAL, arguments: nested }).success).toBe(false);
		const cycle: Record<string, unknown> = {};
		cycle["self"] = cycle;
		expect(___ConversationToolProposalSchema.safeParse({ ..._PROPOSAL, arguments: cycle }).success).toBe(false);
	});
});
