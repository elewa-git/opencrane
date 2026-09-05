import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCraneConversationWorkspaceGateway } from "../opencrane-conversation-workspace.gateway";

/** Construct the adapter with one generated-client test double. */
function _Gateway(post: ReturnType<typeof vi.fn>): OpenCraneConversationWorkspaceGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { POST: post } } }] });
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
});
