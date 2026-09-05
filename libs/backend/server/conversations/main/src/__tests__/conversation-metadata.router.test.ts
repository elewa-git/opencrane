import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { _CreateConversationMetadataRouter } from "../conversation-metadata.router";

/** Verified participant supplied by app composition rather than request data. */
const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" } as const;
/** Mounts one metadata router with an isolated mocked authority. */
function _App(authority: any) { const app = express(); app.use(express.json()); app.use("/api/v1/me/conversations", _CreateConversationMetadataRouter(authority, function _Resolve() { return _CALLER; })); return app; }

describe("_CreateConversationMetadataRouter", function _DescribeMetadataRouter()
{
	it("preserves metadata envelopes without returning relational messages", async function _ReturnsMetadata()
	{
		const conversation = { id: "conversation-1", mode: "direct", lifecycle: "open", agentServiceId: null, participantRefs: ["membership-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null };
		const authority = { directory: vi.fn().mockResolvedValue({ participants: [], personalAgentStatus: "unavailable", personalAgent: null }), list: vi.fn().mockResolvedValue([conversation]), open: vi.fn().mockResolvedValue(conversation), create: vi.fn().mockResolvedValue(conversation), archive: vi.fn().mockResolvedValue(conversation), close: vi.fn().mockResolvedValue(conversation) };
		const response = await request(_App(authority)).get("/api/v1/me/conversations/conversation-1");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ conversation });
		expect(response.body.conversation).not.toHaveProperty("messages");
	});

	it("keeps agent-session creation unavailable when its injected resolver cannot establish identity", async function _FailsClosed()
	{
		const authority = { directory: vi.fn(), list: vi.fn(), open: vi.fn(), create: vi.fn().mockResolvedValue(null), archive: vi.fn(), close: vi.fn() };
		const response = await request(_App(authority)).post("/api/v1/me/conversations").send({ mode: "agent_session", personalAgentRef: "agent-1" });
		expect(response.status).toBe(404);
		expect(authority.create).toHaveBeenCalledWith(_CALLER, { mode: "agent_session", personalAgentRef: "agent-1" });
	});
});
