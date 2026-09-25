import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { _CreateConversationMetadataRouter } from "../conversation-metadata.router";
import { PrismaConversationMetadataUnitOfWork } from "../prisma-conversation-metadata";
import { PrismaAgentSessionCreationUnitOfWork } from "../../sessions/agent-session-creation";

/** Verified participant supplied by app composition rather than request data. */
const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" } as const;
/** Mounts one metadata router with an isolated mocked authority. */
function _App(authority: any, logger = { warn: vi.fn() }) { const app = express(); app.use(express.json()); app.use("/api/v1/me/conversations", _CreateConversationMetadataRouter(authority, function _Resolve() { return _CALLER; }, logger)); return app; }

describe("_CreateConversationMetadataRouter", function _DescribeMetadataRouter()
{
	it("logs a bounded creation diagnostic while hiding dependency details from the response", async function ()
	{
		const failure = Object.assign(new Error("private upstream response"), { code: "P2002", token: "private credential" });
		const logger = { warn: vi.fn() };
		const response = await request(_App({ create: vi.fn().mockRejectedValue(failure) }, logger)).post("/api/v1/me/conversations").send({ text: "private user input" });
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "conversation_authority_unavailable" });
		expect(logger.warn).toHaveBeenCalledWith({ err: { type: "Error", message: "Conversation history operation failed", code: "P2002" }, errorType: "Error", siloId: "silo-1", operation: "/", method: "POST" }, "Conversation metadata operation unavailable");
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private");
	});

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
		const command = { mode: "agent_session", personalAgentRef: "agent-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292" };
		const response = await request(_App(authority)).post("/api/v1/me/conversations").send(command);
		expect(response.status).toBe(404);
		expect(authority.create).toHaveBeenCalledWith(_CALLER, command);
	});

	it("passes the caller and creation key through the metadata boundary without accepting identity fields", async function _CreationCoordinates()
	{
		const resolve = vi.fn().mockResolvedValue(null);
		const authority = new PrismaConversationMetadataUnitOfWork({} as never, { resolve, createOrdinaryGenesis: vi.fn() });
		const command = { mode: "agent_session", personalAgentRef: "agent-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292" };
		await request(_App(authority)).post("/api/v1/me/conversations").send(command);
		expect(resolve).toHaveBeenCalledWith(_CALLER, command.personalAgentRef, command.idempotencyKey);
		resolve.mockClear();
		const response = await request(_App(authority)).post("/api/v1/me/conversations").send({ ...command, principalId: "other-principal", conversationId: "other-conversation" });
		expect(response.status).toBe(404);
		expect(resolve).not.toHaveBeenCalled();
	});

	it.each([undefined, null, 42, {}])("rejects a missing or non-string session creation key before persistence", async function _MalformedCreate(idempotencyKey)
	{
		const prisma = { $transaction: vi.fn() };
		const store = { append: vi.fn(), appendAtomic: vi.fn(), readHead: vi.fn(), readStream: vi.fn() };
		const resolver = new PrismaAgentSessionCreationUnitOfWork(prisma as never, store, []);
		const authority = new PrismaConversationMetadataUnitOfWork(prisma as never, resolver);
		const response = await request(_App(authority)).post("/api/v1/me/conversations").send({ mode: "agent_session", personalAgentRef: "agent-1", idempotencyKey });
		expect(response.status).toBe(404);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(store.appendAtomic).not.toHaveBeenCalled();
	});
});
