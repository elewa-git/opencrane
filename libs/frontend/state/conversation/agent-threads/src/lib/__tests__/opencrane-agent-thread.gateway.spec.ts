import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { AgentThreadGatewayErrorKinds } from "../agent-thread-gateway.errors.js";
import { OpenCraneAgentThreadGateway } from "../opencrane-agent-thread.gateway.js";

/** Generated success fixture containing only truthful canonical fields. */
const _DTO = {
	parentConversationId: "parent-1", childConversationId: "child-1", rootConversationId: "parent-1", parentMessageId: "parent-message-1", initiatorUserId: "user-1", agentServiceId: "service-1", agentName: "Research Agent", ask: "Compare the terms", createdAt: "2026-08-12T10:00:00.000Z", lifecycle: "open" as const, participantUserIds: ["user-1"], readThroughPosition: "2", latestPosition: "5", representedThroughPosition: "5", messageCount: 2, unreadMessageCount: 1, cursor: "opaque-cursor",
	messages: [{ id: "message-1", position: "2", role: "assistant" as const, state: "completed" as const, source: "model_output" as const, blocks: [{ id: "block-1", kind: "text" as const, value: "I found one risk." }], runId: "run-1", userId: null, createdAt: "2026-08-12T10:01:00.000Z", completedAt: "2026-08-12T10:01:00.000Z", agentThread: null }],
	runs: [{ id: "run-1", ordinal: 1, attempt: 1, state: "completed" as const, acceptedAt: "2026-08-12T10:00:30.000Z", finishedAt: "2026-08-12T10:01:00.000Z" }],
	deliveries: [],
};

/** Construct the adapter with controlled generated-client methods. */
function _Gateway(client: object): OpenCraneAgentThreadGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneAgentThreadGateway(); });
}

describe("OpenCraneAgentThreadGateway", function _Suite()
{
	it("reads the exact parent-child route and maps the generated DTO", async function _Reads()
	{
		const GET = vi.fn().mockResolvedValue({ data: { agentThread: _DTO }, error: undefined, response: { status: 200 } });
		const snapshot = await _Gateway({ GET }).read("parent-1", "child-1");
		expect(GET).toHaveBeenCalledWith("/me/conversations/{parentConversationId}/agent-threads/{childConversationId}", { params: { path: { parentConversationId: "parent-1", childConversationId: "child-1" } } });
		expect(snapshot).toMatchObject({ parentConversationId: "parent-1", childConversationId: "child-1", summary: { unreadCount: 1, replyCount: 2 }, canSendFollowUp: true });
	});

	it("submits one serial follow-up and re-reads the exact pair", async function _Submits()
	{
		vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("block-1") });
		const POST = vi.fn().mockResolvedValue({ data: { outcome: "accepted" }, error: undefined, response: { status: 202 } });
		const GET = vi.fn().mockResolvedValue({ data: { agentThread: _DTO }, error: undefined, response: { status: 200 } });
		await _Gateway({ GET, POST }).sendFollowUp("parent-1", "child-1", "What changed?", "follow-up-1");
		expect(POST).toHaveBeenCalledWith("/me/conversations/{conversationId}/messages", { params: { path: { conversationId: "child-1" } }, body: { idempotencyKey: "follow-up-1", blocks: [{ id: "block-1", kind: "text", value: "What changed?" }] } });
		expect(GET).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("collapses missing and foreign routes without copying response bodies", async function _Unavailable()
	{
		const GET = vi.fn().mockResolvedValue({ data: undefined, error: { secret: "must-not-copy" }, response: { status: 404 } });
		await expect(_Gateway({ GET }).read("parent-1", "child-1")).rejects.toMatchObject({ kind: AgentThreadGatewayErrorKinds.AccessChanged, message: "This Agent thread is no longer available." });
	});
});
