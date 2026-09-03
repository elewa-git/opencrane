import { ConversationLifecycleModes, ___ConversationCreatedSchema } from "../index";
import { describe, expect, it } from "vitest";

describe("conversation lifecycle validation", function _DescribeConversationLifecycleValidation()
{
	it("accepts one immutable creation anchor with checked provenance", function _AcceptsCreationAnchor()
	{
		expect(___ConversationCreatedSchema.safeParse({ schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Agent, createdAt: "2026-09-02T00:00:00.000Z", provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1" } }).success).toBe(true);
	});

	it("rejects unknown fields and incomplete creation provenance", function _RejectsUnprovenCreation()
	{
		expect(___ConversationCreatedSchema.safeParse({ schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Group, createdAt: "2026-09-02T00:00:00.000Z", provenance: { principalId: "principal-1" } }).success).toBe(false);
		expect(___ConversationCreatedSchema.safeParse({ schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Group, createdAt: "2026-09-02T00:00:00.000Z", provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1" }, extra: true }).success).toBe(false);
	});
});
