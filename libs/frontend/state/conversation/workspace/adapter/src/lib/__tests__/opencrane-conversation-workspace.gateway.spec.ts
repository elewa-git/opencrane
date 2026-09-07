import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationModes } from "@opencrane/models/conversations";

import { OpenCraneConversationWorkspaceGateway } from "../opencrane-conversation-workspace.gateway";

/** Construct the adapter with one generated-client test double. */
function _Gateway(post: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn> = vi.fn()): OpenCraneConversationWorkspaceGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get, POST: post } } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationWorkspaceGateway(); });
}

describe("OpenCraneConversationWorkspaceGateway", function _DescribeMessageGateway()
{
	it("binds a child request to the selected parent and preserves its retry command and abort signal", async function _ChildRequest()
	{
		const command = { parentMessageId: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", parentMessagePosition: "2", agentServiceId: "company", idempotencyKey: "c26f4e78-56ee-4ed2-a8be-06f13ef98164" };
		const child = { conversationId: "child", parentConversationId: "group", parentMessageId: command.parentMessageId, parentMessagePosition: "2", state: "pending", agentName: "Research" };
		const signal = new AbortController().signal;
		const post = vi.fn().mockResolvedValue({ data: { child }, response: { status: 202 } });
		await expect(_Gateway(post).createChild("group", command, signal)).resolves.toEqual(child);
		expect(post).toHaveBeenCalledWith("/me/conversations/{conversationId}/children", { params: { path: { conversationId: "group" } }, body: command, signal });
		post.mockResolvedValueOnce({ data: { child: { ...child, parentConversationId: "other" } } });
		await expect(_Gateway(post).createChild("group", command, signal)).rejects.toThrow("invalid conversation response");
	});

	it("rejects malformed or foreign child lists and keeps server error text out of failures", async function _ChildrenBoundary()
	{
		const signal = new AbortController().signal;
		const get = vi.fn().mockResolvedValueOnce({ data: { children: [], secret: "unsafe" } }).mockResolvedValueOnce({ error: { message: "database secret" }, response: { status: 404 } });
		const gateway = _Gateway(vi.fn(), get);
		await expect(gateway.listChildren("group", signal)).rejects.toThrow("invalid conversation response");
		await expect(gateway.listChildren("group", signal)).rejects.toMatchObject({ kind: "access_changed", message: "This conversation is no longer available." });
	});

	it("posts the reviewed share unchanged and validates both accepted and idempotent acknowledgements", async function _ReviewedShare()
	{
		const signal = new AbortController().signal;
		const command = { sourceEntryId: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", sourcePosition: "4", text: "My reviewed result", idempotencyKey: "c26f4e78-56ee-4ed2-a8be-06f13ef98164" };
		const post = vi.fn().mockResolvedValueOnce({ data: { outcome: "accepted", position: "5" } }).mockResolvedValueOnce({ data: { outcome: "idempotent", position: "5" } }).mockResolvedValueOnce({ data: { outcome: "accepted", position: "-1" } });
		const gateway = _Gateway(post);
		await gateway.shareChild("child", command, signal);
		await gateway.shareChild("child", command, signal);
		expect(post).toHaveBeenNthCalledWith(1, "/me/conversations/{conversationId}/share", { params: { path: { conversationId: "child" } }, body: command, signal });
		await expect(gateway.shareChild("child", command, signal)).rejects.toThrow("invalid conversation response");
	});

	it("preserves the caller's session creation key in the generated API body", async function _CreatesSession()
	{
		const conversation = { id: "conversation-1", mode: "agent_session", lifecycle: "open", agentServiceId: "agent-1", participantRefs: ["membership-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z", visibleFromPosition: "1", parent: null, accessEndedPosition: null };
		const post = vi.fn().mockResolvedValue({ data: { conversation } });
		const command = { mode: ConversationModes.AgentSession, personalAgentRef: "agent-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292" } as const;
		await _Gateway(post).create(command);
		expect(post).toHaveBeenCalledWith("/me/conversations", { body: command });
	});

	it.each([ConversationModes.Direct, ConversationModes.Group] as const)("preserves the %s creation UUID and member references in the generated request", async function _CreatesOrdinary(mode)
	{
		const conversation = { id: "conversation-1", mode, lifecycle: "open", agentServiceId: null, participantRefs: ["membership-1", "membership-2"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z", visibleFromPosition: "1", parent: null, accessEndedPosition: null };
		const post = vi.fn().mockResolvedValue({ data: { conversation } });
		const command = { mode, participantRefs: ["membership-2"], idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292" } as const;
		await _Gateway(post).create(command);
		expect(post).toHaveBeenCalledWith("/me/conversations", { body: command });
	});

	it("submits participant text with its explicit computer activation", async function _SubmitsHistoryMessage()
	{
		const post = vi.fn().mockResolvedValue({ data: { outcome: "appended", position: "1" } });
		const gateway = _Gateway(post);
		await gateway.send({ conversationId: "conversation-1", idempotencyKey: "command-1", text: "Hello", activation: "start" });
		expect(post).toHaveBeenCalledWith("/me/conversations/{conversationId}/messages", { params: { path: { conversationId: "conversation-1" } }, body: { idempotencyKey: "command-1", text: "Hello", activation: "start" } });
	});

	it("rejects malformed command output before state can adopt it", async function _RejectsCommand()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue({ data: { exitCode: "zero", outcome: "completed", output: "unsafe", truncated: false } }));
		await expect(gateway.runComputerCommand("conversation-1", ["git", "status"], ".")).rejects.toThrow("invalid conversation response");
	});

	it("rejects the entire browser target response when one target is malformed", async function _RejectsTargets()
	{
		const get = vi.fn().mockResolvedValue({ data: [{ id: "page-1", title: "Ready", url: "http://127.0.0.1:5173/" }, { id: "", title: 1, url: "javascript:alert(1)" }] });
		const gateway = _Gateway(vi.fn(), get);
		await expect(gateway.listComputerBrowserTargets("conversation-1")).rejects.toThrow("invalid conversation response");
	});

	it("rejects an empty or wrongly typed screenshot", async function _RejectsScreenshot()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue({ data: new Blob([], { type: "text/html" }) }));
		await expect(gateway.captureComputerScreenshot("conversation-1", 5173, "/", 1280, 720)).rejects.toThrow();
	});
});
