import { describe, expect, it } from "vitest";

import { __AuthorizeConversationRead } from "../conversation-read-authorization.js";

/** Canonical open participant-bound conversation. */
const _CONVERSATION = { conversationId: "conversation-1", siloId: "silo-1", agentServiceId: "service-1", mode: "agent_session", lifecycle: "open", participantUserIds: ["user-1"] } as const;

/** Canonical read decision input. */
function _Command()
{
	return { subjectId: "user-1", siloId: "silo-1", conversationId: "conversation-1", agentServiceId: "service-1", scope: { kind: "organization", organizationId: "silo-1" }, requiredActions: ["conversation.read"], membershipRevision: 7, nowEpochMs: 1_000 } as const;
}

describe("conversation read authorization", function _DescribeConversationReadAuthorization()
{
	it("digests the complete accepted authority evidence", function _DigestsAuthorityEvidence()
	{
		const first = __AuthorizeConversationRead(_CONVERSATION, _Command());
		const second = __AuthorizeConversationRead(_CONVERSATION, { ..._Command(), membershipRevision: 8 });

		expect(first.outcome).toBe("allowed");
		expect(first.outcome === "allowed" ? first.authorizationDigest : "").toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(second).not.toEqual(first);
	});

	it("requires exact organization scope and participant membership", function _RequiresScopeAndParticipant()
	{
		expect(__AuthorizeConversationRead(_CONVERSATION, { ..._Command(), scope: { kind: "organization", organizationId: "other" } })).toEqual({ outcome: "denied", reason: "scope_mismatch" });
		expect(__AuthorizeConversationRead({ ..._CONVERSATION, participantUserIds: [] }, _Command())).toEqual({ outcome: "denied", reason: "participant_unavailable" });
	});

	it("rejects changed conversation coordinates and unsupported actions", function _RejectsChangedAuthority()
	{
		expect(__AuthorizeConversationRead(_CONVERSATION, { ..._Command(), conversationId: "other" })).toEqual({ outcome: "denied", reason: "conversation_mismatch" });
		expect(__AuthorizeConversationRead(_CONVERSATION, { ..._Command(), requiredActions: [] })).toEqual({ outcome: "denied", reason: "action_not_allowed" });
	});
});
