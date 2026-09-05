import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCraneConversationWorkspaceGateway } from "../opencrane-conversation-workspace.gateway";

/** Construct the adapter with one generated-client test double. */
function _Gateway(post: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn> = vi.fn()): OpenCraneConversationWorkspaceGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get, POST: post } } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationWorkspaceGateway(); });
}

describe("OpenCraneConversationWorkspaceGateway", function _DescribeMessageGateway()
{
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
