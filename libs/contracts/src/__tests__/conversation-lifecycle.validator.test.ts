import { ConversationLifecycleModes, ___ConversationCreatedSchema } from "../index";
import { describe, expect, it } from "vitest";

describe("conversation lifecycle validation", function _DescribeConversationLifecycleValidation()
{
	it("accepts one immutable creation anchor with checked provenance", function _AcceptsCreationAnchor()
	{
		expect(___ConversationCreatedSchema.safeParse({ schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Agent, participants: [{ userId: "user-1", visibleFromPosition: "0", joinedAt: "2026-09-02T00:00:00.000Z" }], agentBinding: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", computerId: "computer-1" }, createdAt: "2026-09-02T00:00:00.000Z", provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1", requestId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" } }).success).toBe(true);
	});

	it("rejects unknown fields and incomplete creation provenance", function _RejectsUnprovenCreation()
	{
		const created = { schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Group, participants: [{ userId: "user-1", visibleFromPosition: "0", joinedAt: "2026-09-02T00:00:00.000Z" }], agentBinding: null, createdAt: "2026-09-02T00:00:00.000Z", provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1", requestId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" } };
		expect(___ConversationCreatedSchema.safeParse({ ...created, provenance: { principalId: "principal-1" } }).success).toBe(false);
		expect(___ConversationCreatedSchema.safeParse({ ...created, extra: true }).success).toBe(false);
		expect(___ConversationCreatedSchema.safeParse({ ...created, mode: ConversationLifecycleModes.Direct, agentBinding: { agentServiceId: "service-1" } }).success).toBe(false);
		expect(___ConversationCreatedSchema.safeParse({ ...created, mode: ConversationLifecycleModes.Agent }).success).toBe(false);
	});
});
